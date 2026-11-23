"""Private FastAPI process hosting the LangGraph worker and health endpoints."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
import re

import uvicorn
from fastapi import FastAPI, Response
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .providers import create_image_provider
from .providers.cloudflare_pixel_vision import (
    CloudflarePixelVisionProvider, CloudflarePixelVisionProviderV2, CloudflarePixelVisionProviderV3,
)
from .transport.node_api import NodeAgentClient
from .worker import worker_loop, resume_worker_loop

log = logging.getLogger(__name__)


@asynccontextmanager
async def checkpoint_pool(dsn: str, schema: str):
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema):
        raise ValueError("Invalid checkpoint schema name")
    async with AsyncConnectionPool(
        dsn, min_size=1, max_size=4, timeout=10, open=False,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row,
                "options": f"-c search_path={schema}"},
        check=AsyncConnectionPool.check_connection,
    ) as pool:
        async with pool.connection() as connection:
            await connection.execute("SELECT pg_advisory_lock(hashtext(%s), 3)", (schema,))
            try:
                if schema != "public":
                    await connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
                await AsyncPostgresSaver(connection).setup()
            finally:
                await connection.execute("SELECT pg_advisory_unlock(hashtext(%s), 3)", (schema,))
        yield pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    token = os.environ["AGENT_SERVICE_TOKEN"]
    if len(token) < 32 or len(token) > 512 or any(c.isspace() for c in token):
        raise ValueError("AGENT_SERVICE_TOKEN must be a private 32–512 character token")
    api_url = os.getenv("AGENT_API_URL") or "http://127.0.0.1:8787"
    wait_ms = int(os.getenv("AGENT_LEASE_WAIT_MS", "20000"))
    if not 0 <= wait_ms <= 20_000:
        raise ValueError("AGENT_LEASE_WAIT_MS must be between 0 and 20000")
    async with checkpoint_pool(os.environ["AGENT_CHECKPOINT_DATABASE_URL"],
                               os.getenv("AGENT_CHECKPOINT_SCHEMA", "public")) as pool:
        client = NodeAgentClient(api_url, token)
        saver = AsyncPostgresSaver(pool)
        provider_name = os.getenv("IMAGE_PROVIDER", "cloudflare")
        provider = create_image_provider(provider_name)
        pixel_provider = provider if provider_name == "cloudflare" else create_image_provider("cloudflare")
        worker = asyncio.create_task(worker_loop(client, provider, saver, wait_ms=wait_ms,
            pixel_provider=pixel_provider, pixel_vision=CloudflarePixelVisionProvider(),
            pixel_detailed_vision=CloudflarePixelVisionProviderV2(),
            pixel_layered_hair_vision=CloudflarePixelVisionProviderV3(),
            worker_id=os.getenv("AGENT_WORKER_ID") or None))
        resume_worker = asyncio.create_task(resume_worker_loop(client, saver, wait_ms=wait_ms,
            worker_id=os.getenv("AGENT_RESUME_WORKER_ID") or None))
        app.state.worker = worker
        app.state.resume_worker = resume_worker
        app.state.checkpoint_pool = pool
        try:
            yield
        finally:
            worker.cancel()
            resume_worker.cancel()
            await asyncio.gather(worker, resume_worker, return_exceptions=True)
            await client.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/healthz")
async def healthz(response: Response):
    worker = getattr(app.state, "worker", None)
    resume_worker = getattr(app.state, "resume_worker", None)
    healthy = bool(worker and not worker.done() and resume_worker and not resume_worker.done())
    if healthy:
        try:
            async with app.state.checkpoint_pool.connection(timeout=2) as connection:
                await connection.execute("SELECT 1")
        except Exception:
            healthy = False
    if not healthy:
        response.status_code = 503
    return {"ok": healthy, "component": "agent"}


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    logging.getLogger("httpx").setLevel(logging.WARNING)
    uvicorn.run(app, host=os.getenv("AGENT_HOST", "127.0.0.1"),
                port=int(os.getenv("AGENT_PORT", "8788")), log_config=None)


if __name__ == "__main__":
    main()
