import asyncio
import base64
import io
import json
import random
from pathlib import Path
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import MemorySaver
from PIL import Image

from buildurprofile_agent.graph import build_generation_graph, task_input
from buildurprofile_agent.skills.avatar import compact_generated_image, valid_cutout
from buildurprofile_agent.providers.openai_images import GeneratedImage
from buildurprofile_agent.providers.base import ImageProviderError
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
        self.stored_image = None
        self.cutout_image = None

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
        self.stored_image = image
        self.asset_id = str(uuid4())
        return self.asset_id

    async def store_cutout(self, task, image):
        self.cutout_image = image
        return str(uuid4())

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
    def __init__(self, image=None):
        self.calls = 0
        self.image = image or GeneratedImage(png())

    async def edit(self, portrait, recipe, *, task_id):
        self.calls += 1
        return self.image

    async def cutout(self, image):
        layer = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        for y in range(32, 256):
            for x in range(48, 208):
                layer.putpixel((x, y), (120, 30, 200, 255))
        stream = io.BytesIO()
        layer.save(stream, format="PNG")
        return GeneratedImage(stream.getvalue())


def noisy_png() -> bytes:
    stream = io.BytesIO()
    pixels = random.Random(42).randbytes(1024 * 1024 * 3)
    Image.frombytes("RGB", (1024, 1024), pixels).save(stream, format="PNG")
    return stream.getvalue()


def test_cutout_quality_rejects_opaque_image_and_compression_preserves_alpha():
    assert valid_cutout(GeneratedImage(png())) is False
    layer = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    for y in range(64, 512):
        for x in range(96, 416):
            layer.putpixel((x, y), (120, 30, 200, 255))
    stream = io.BytesIO()
    layer.save(stream, format="PNG")
    cutout = GeneratedImage(stream.getvalue())
    assert valid_cutout(cutout) is True
    with Image.open(io.BytesIO(compact_generated_image(cutout).bytes)) as saved:
        assert saved.getchannel("A").getpixel((0, 0)) == 0


def test_cutout_quality_accepts_a_person_whose_clothing_reaches_bottom_corners():
    layer = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    layer.paste((120, 30, 200, 255), (96, 64, 416, 256))
    layer.paste((120, 30, 200, 255), (0, 256, 512, 512))
    stream = io.BytesIO()
    layer.save(stream, format="PNG")
    assert valid_cutout(GeneratedImage(stream.getvalue())) is True


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
    assert client.cutout_image is None  # Old workflow keeps its original Skill contract.
    await graph.ainvoke(task_input(item), config={"configurable": {"thread_id": item.id + "-retry"}})
    assert provider.calls == client.writes == 1


@pytest.mark.asyncio
async def test_avatar_skill_compacts_large_generated_image_before_storage():
    client = FakeClient()
    provider = FakeProvider(GeneratedImage(noisy_png()))
    item = task(portrait=True)
    graph = build_generation_graph(item, client, provider, default_registry(), checkpointer=MemorySaver())
    await graph.ainvoke(task_input(item), config={"configurable": {"thread_id": item.id}})
    assert client.stored_image.mime == "image/webp"
    assert len(client.stored_image.bytes) <= 600_000
    with Image.open(io.BytesIO(client.stored_image.bytes)) as image:
        assert image.size[0] >= 512 and image.size[1] >= 512


@pytest.mark.asyncio
async def test_worker_acknowledges_cancellation_before_side_effect():
    client = FakeClient()
    client.cancelled = True
    item = task(portrait=True)
    await process_task(item, client, FakeProvider(), default_registry(), MemorySaver())
    assert client.completed is None and client.writes == 0 and client.failed is None

@pytest.mark.asyncio
async def test_v3_preserves_supplements_and_refuses_version_mix():
    from dataclasses import replace
    from copy import deepcopy
    item = task()
    brief = deepcopy(item.brief)
    resume = json.loads((FIXTURE.parent / 'resume-enrichment.v2.json').read_text())
    brief['content']['resume'] = resume
    item = replace(item, workflow_version='python-agent-v3', brief=brief)
    client = FakeClient()
    graph = build_generation_graph(item, client, FakeProvider(), default_registry())
    state = await graph.ainvoke(task_input(item))
    assert state['config']['content']['resume'] == resume
    assert 'resume.compose.v3' in state['skill_plan']
    assert 'artifact.qa.v2' in state['skill_plan']
    old = replace(item, workflow_version='python-agent-v2')
    with pytest.raises(ValueError):
        await build_generation_graph(old, client, FakeProvider(), default_registry()).ainvoke(task_input(old))

@pytest.mark.asyncio
async def test_v3_portrait_regeneration_keeps_existing_confirmed_config():
    from dataclasses import replace
    golden = json.loads((FIXTURE.parent / 'agent-golden.v2.json').read_text())
    item = replace(task(portrait=True), workflow_version='python-agent-v3', brief=None,
                   config=golden['expected']['config'])
    client, provider = FakeClient(), FakeProvider()
    graph = build_generation_graph(item, client, provider, default_registry())
    state = await graph.ainvoke(task_input(item))
    assert state['config']['content'] == golden['expected']['config']['content']
    assert state['skill_plan'] == ['avatar.wibi.v1', 'artifact.qa.v2']
    assert provider.calls == 1


@pytest.mark.asyncio
async def test_v4_preserves_user_order_and_uses_versioned_skills():
    from dataclasses import replace
    item = task()
    golden = json.loads((FIXTURE.parent / 'agent-golden.v3.json').read_text())
    item = replace(item, workflow_version='python-agent-v4', brief=golden['input'])
    state = await build_generation_graph(item, FakeClient(), FakeProvider(), default_registry()).ainvoke(task_input(item))
    assert state['config'] == golden['expected']['config']
    assert state['skill_plan'] == ['assessment.score.v1', 'design.map.v1', 'resume.compose.v4', 'artifact.qa.v3']


@pytest.mark.asyncio
async def test_v5_generates_selected_template_without_assessment():
    from dataclasses import replace
    golden = json.loads((FIXTURE.parent / 'agent-golden.v3.json').read_text())
    brief = {"role": golden["input"]["role"], "content": golden["input"]["content"],
             "templateId": "cyber-creator-v1"}
    item = replace(task(), workflow_version='python-agent-v5', brief=brief)
    state = await build_generation_graph(item, FakeClient(), FakeProvider(), default_registry()).ainvoke(task_input(item))
    assert state['config']['templateId'] == 'cyber-creator-v1'
    assert state['config']['skin'] == 'dark-tech'
    assert state['config']['content'] == brief['content']
    assert state['skill_plan'] == ['design.template.v1', 'resume.compose.v5', 'artifact.qa.v4']


@pytest.mark.asyncio
async def test_v6_portrait_runs_versioned_cutout_skill():
    from dataclasses import replace
    golden = json.loads((FIXTURE.parent / 'agent-golden.v3.json').read_text())
    brief = {"role": golden["input"]["role"], "content": golden["input"]["content"],
             "templateId": "cyber-creator-v1"}
    item = replace(task(portrait=True), workflow_version='python-agent-v6', brief=brief)
    client = FakeClient()
    state = await build_generation_graph(item, client, FakeProvider(), default_registry()).ainvoke(task_input(item))
    assert state['skill_plan'] == ['design.template.v1', 'resume.compose.v5', 'avatar.wibi.v2', 'artifact.qa.v4']
    assert client.cutout_image is not None


@pytest.mark.asyncio
async def test_v6_cutout_failure_keeps_original_artwork_and_reports_reason(caplog):
    from dataclasses import replace
    golden = json.loads((FIXTURE.parent / 'agent-golden.v3.json').read_text())
    brief = {"role": golden["input"]["role"], "content": golden["input"]["content"],
             "templateId": "cyber-creator-v1"}

    class FailingCutout(FakeProvider):
        async def cutout(self, image):
            raise ImageProviderError("CUTOUT_BILLING_REQUIRED")

    item = replace(task(portrait=True), workflow_version='python-agent-v6', brief=brief)
    client = FakeClient()
    state = await build_generation_graph(item, client, FailingCutout(), default_registry()).ainvoke(task_input(item))
    assert state['qa'] is True
    assert state['output_asset_id'] == client.asset_id
    assert client.cutout_image is None
    assert any("CUTOUT_BILLING_REQUIRED" in record.message and item.id in record.message
               for record in caplog.records)
