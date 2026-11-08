import asyncio
import base64
import io
import json
from pathlib import Path
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import MemorySaver
from PIL import Image

from buildurprofile_agent.graph import build_generation_graph, task_input
from buildurprofile_agent.providers.openai_images import GeneratedImage
from buildurprofile_agent.skills.registry import default_registry
from buildurprofile_agent.transport.node_api import AgentTask, CancelRequested, Portrait
from buildurprofile_agent.worker import process_task


FIXTURE = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/agent-golden.v1.json"
GOLDEN = json.loads(FIXTURE.read_text())


def png() -> bytes:
    stream = io.BytesIO()
    Image.new("RGB", (256, 256), (240, 210, 190)).save(stream, format="PNG")
    return stream.getvalue()


class FakeClient:
    def __init__(self):
        self.asset_id = None
        self.completed = None
        self.failed = None
        self.cancelled = False
        self.writes = 0

    async def check_cancel(self, task):
        if self.cancelled:
            raise CancelRequested("cancelled")

    async def portrait(self, task):
        return Portrait(png(), "image/png")

    async def recipe(self, task):
        return {"id": task.style_id, "version": "pinned-recipe", "license":
                "MIT AND LicenseRef-Wibi-Personal-NonCommercial-1.0", "instructions": "flat anime",
                "referenceImages": [{"mime": "image/png", "dataBase64": base64.b64encode(png()).decode()}]}

    async def output(self, task):
        return {"assetId": self.asset_id, "exists": self.asset_id is not None}

    async def store_output(self, task, image):
        self.writes += 1
        self.asset_id = str(uuid4())
        return self.asset_id

    async def complete(self, task, config):
        self.completed = config
        return True

    async def fail(self, task, code, *, retryable):
        self.failed = (code, retryable)
        return True

    async def ack_cancel(self, task):
        self.cancelled = True
        return True


class FakeProvider:
    def __init__(self):
        self.calls = 0

    async def edit(self, portrait, recipe, *, task_id):
        self.calls += 1
        return GeneratedImage(png())


def task(*, portrait=False):
    return AgentTask(str(uuid4()), str(uuid4()), "python-agent-v2", GOLDEN["input"], None,
                     str(uuid4()) if portrait else None, "retro-flat-anime-head" if portrait else None, None)


@pytest.mark.asyncio
async def test_golden_text_only_graph():
    client = FakeClient()
    item = task()
    graph = build_generation_graph(item, client, FakeProvider(), default_registry(), checkpointer=MemorySaver())
    state = await graph.ainvoke(task_input(item), config={"configurable": {"thread_id": item.id}})
    assert state["vector"] == GOLDEN["expected"]["vector"]
    assert state["config"] == GOLDEN["expected"]["config"]
    assert state["qa"] is True
    assert state["skill_plan"] == ["assessment.score.v1", "design.map.v1", "resume.compose.v2", "artifact.qa.v1"]
    assert client.writes == 0


@pytest.mark.asyncio
async def test_avatar_skill_runs_with_capabilities_and_reuses_asset():
    client, provider = FakeClient(), FakeProvider()
    item = task(portrait=True)
    graph = build_generation_graph(item, client, provider, default_registry(), checkpointer=MemorySaver())
    state = await graph.ainvoke(task_input(item), config={"configurable": {"thread_id": item.id}})
    assert state["qa"] is True
    assert state["output_asset_id"] == client.asset_id
    assert state["recipe_version"] == "pinned-recipe"
    assert provider.calls == client.writes == 1
    await graph.ainvoke(task_input(item), config={"configurable": {"thread_id": item.id + "-retry"}})
    assert provider.calls == client.writes == 1


@pytest.mark.asyncio
async def test_worker_acknowledges_cancellation_before_side_effect():
    client = FakeClient()
    client.cancelled = True
    item = task(portrait=True)
    await process_task(item, client, FakeProvider(), default_registry(), MemorySaver())
    assert client.completed is None and client.writes == 0 and client.failed is None
