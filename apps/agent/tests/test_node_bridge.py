"""Actual Node HTTP lease → Python LangGraph → Node completion contract."""

import asyncio
import io
import json
import os
from pathlib import Path
import subprocess

import pytest
from langgraph.checkpoint.memory import MemorySaver
from PIL import Image

from buildurprofile_agent.skills.registry import default_registry
from buildurprofile_agent.providers.openai_images import GeneratedImage
from buildurprofile_agent.transport.node_api import NodeAgentClient
from buildurprofile_agent.worker import process_task


ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.asyncio
async def test_real_node_bridge_text_only():
    token = "b" * 64
    proc = subprocess.Popen(["node", "apps/agent/tests/fixtures/bridge-server.mjs"], cwd=ROOT,
                            env={**os.environ, "AGENT_SERVICE_TOKEN": token},
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True)
    try:
        line = await asyncio.wait_for(asyncio.to_thread(proc.stdout.readline), timeout=10)
        if not line:
            raise AssertionError(proc.stderr.read())
        endpoint = json.loads(line)
        client = NodeAgentClient(endpoint["baseUrl"], token)
        try:
            task = await client.lease("python_integration")
            assert task and task.id == endpoint["taskId"]
            await process_task(task, client, object(), default_registry(), MemorySaver(), "python_integration")
            photo_task = await client.lease("python_integration")
            assert photo_task and photo_task.id == endpoint["portraitTaskId"]

            class MockImageProvider:
                calls = 0

                async def edit(self, portrait, recipe, *, task_id):
                    self.calls += 1
                    assert portrait.mime in ("image/png", "image/jpeg", "image/webp")
                    assert recipe["id"] == "retro-flat-anime-head"
                    output = io.BytesIO()
                    with Image.open(io.BytesIO(portrait.bytes)) as source:
                        source.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS).save(output, format="PNG")
                    assert len(output.getvalue()) <= 10 * 1024 * 1024
                    return GeneratedImage(output.getvalue())

            provider = MockImageProvider()
            await process_task(photo_task, client, provider, default_registry(), MemorySaver(), "python_integration")
            assert provider.calls == 1
            assert await client.lease("python_integration") is None
        finally:
            await client.close()
    finally:
        proc.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
            await asyncio.to_thread(proc.wait)
