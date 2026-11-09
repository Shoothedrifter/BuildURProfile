"""Private FastAPI process hosting the LangGraph worker and health endpoints."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Response
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from .providers import create_image_provider
from .transport.node_api import NodeAgentClient
from .worker import worker_loop, resume_worker_loop

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    token = os.environ["AGENT_SERVICE_TOKEN"]
    if len(token) < 32 or len(token) > 512 or any(c.isspace() for c in token):
        raise ValueError("AGENT_SERVICE_TOKEN must be a private 32–512 character token")
    api_url = os.getenv("AGENT_API_URL") or "http://127.0.0.1:8787"
    checkpoint_path = Path(os.getenv("AGENT_CHECKPOINT_PATH") or "data/agent-checkpoints.sqlite")
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    client = NodeAgentClient(api_url, token)
    async with AsyncSqliteSaver.from_conn_string(str(checkpoint_path)) as saver:
        await saver.setup()
        provider = create_image_provider(os.getenv("IMAGE_PROVIDER", "cloudflare"))
        worker = asyncio.create_task(worker_loop(client, provider, saver,
            worker_id=os.getenv("AGENT_WORKER_ID") or None))
        resume_worker = asyncio.create_task(resume_worker_loop(client, saver,
            worker_id=os.getenv("AGENT_RESUME_WORKER_ID") or None))
        app.state.worker = worker
        app.state.resume_worker = resume_worker
        try:
            yield
        finally:
            worker.cancel()
            resume_worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
            with suppress(asyncio.CancelledError):
                await resume_worker
            await client.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/healthz")
async def healthz(response: Response):
    worker = getattr(app.state, "worker", None)
    resume_worker = getattr(app.state, "resume_worker", None)
    healthy = bool(worker and not worker.done() and resume_worker and not resume_worker.done())
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
