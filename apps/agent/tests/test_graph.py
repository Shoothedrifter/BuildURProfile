import asyncio
import base64
import io
import json
import random
from dataclasses import replace
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


def test_cutout_quality_accepts_close_crop_with_hat_touching_top_corner():
    # A close portrait may fill 91% of the frame and touch a top corner.
    layer = Image.new("RGBA", (256, 256), (120, 30, 200, 255))
    for y in range(256):
        for x in range(24):
            layer.putpixel((x, y), (0, 0, 0, 0))
    stream = io.BytesIO()
    layer.save(stream, format="PNG")
    assert valid_cutout(GeneratedImage(stream.getvalue())) is True


def test_cutout_quality_rejects_single_transparent_pixel_and_empty_subject():
    layer = Image.new("RGBA", (256, 256), (120, 30, 200, 255))
    layer.putpixel((0, 0), (0, 0, 0, 0))
    for candidate in (layer, Image.new("RGBA", (256, 256), (0, 0, 0, 0))):
        stream = io.BytesIO()
        candidate.save(stream, format="PNG")
        assert valid_cutout(GeneratedImage(stream.getvalue())) is False


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
async def test_v7_pixel_world_runs_without_portrait():
    from dataclasses import replace
    golden = json.loads((FIXTURE.parent / "agent-golden.v3.json").read_text())
    brief = {"role": golden["input"]["role"], "content": golden["input"]["content"], "templateId": "pixel-world-v1"}
    item = replace(task(), workflow_version="python-agent-v7", brief=brief)
    provider = FakeProvider()
    result = await build_generation_graph(item, FakeClient(), provider, default_registry()).ainvoke(task_input(item))
    assert result["qa"] is True
    assert result["config"]["templateId"] == "pixel-world-v1"
    assert result["config"]["content"] == brief["content"]
    assert result["output_asset_id"] is None and provider.calls == 0
    assert result["skill_plan"] == ["design.template.v2", "resume.compose.v5", "artifact.qa.v4"]


@pytest.mark.asyncio
async def test_v7_pixel_avatar_uses_leased_capabilities_and_reuses_output():
    from dataclasses import replace

    class PixelClient(FakeClient):
        async def recipe(self, task):
            return {"id": "pixel-halfbody-v1", "version": "1.1.0",
                    "license": "LicenseRef-BuildURProfile-Original-Preview-1.0",
                    "instructions": "square pixel bust", "referenceImages": ["pinned-reference"]}

    golden = json.loads((FIXTURE.parent / "agent-golden.v3.json").read_text())
    config = {**golden["expected"]["config"], "templateId": "pixel-world-v1"}
    item = replace(task(portrait=True), workflow_version="python-agent-v7", brief=None, config=config,
                   style_id="pixel-halfbody-v1")
    client, legacy, pixel = PixelClient(), FakeProvider(), FakeProvider()
    for _ in range(2):
        await process_task(item, client, legacy, default_registry(), MemorySaver(), pixel_provider=pixel)
    assert (pixel.calls, legacy.calls, client.writes, client.cutout_image) == (1, 0, 1, None)
    assert client.completed == config
    with Image.open(io.BytesIO(client.stored_image.bytes)) as image:
        assert image.size == (512, 512)


@pytest.mark.asyncio
async def test_v7_pixel_avatar_drops_output_when_cancelled_while_the_provider_runs():
    from dataclasses import replace

    class PixelClient(FakeClient):
        async def recipe(self, task):
            return {"id": task.style_id, "version": "1.1.0",
                    "license": "LicenseRef-BuildURProfile-Original-Preview-1.0", "referenceImages": ["reference"]}

    class CancellingProvider(FakeProvider):
        async def edit(self, portrait, recipe, *, task_id):
            client.cancelled = True
            return self.image

    client = PixelClient()
    golden = json.loads((FIXTURE.parent / "agent-golden.v3.json").read_text())
    item = replace(task(portrait=True), workflow_version="python-agent-v7", brief=None,
                   config={**golden["expected"]["config"], "templateId": "pixel-world-v1"}, style_id="pixel-halfbody-v1")
    await process_task(item, client, FakeProvider(), default_registry(), MemorySaver(), pixel_provider=CancellingProvider())
    assert client.cancelled and client.writes == 0
    assert client.completed is None


def layered_pixel_task():
    golden = json.loads((FIXTURE.parent / "agent-golden.v3.json").read_text())
    return replace(task(portrait=True), workflow_version="python-agent-v8", brief=None,
                   config={**golden["expected"]["config"], "templateId": "pixel-world-v1"}, style_id="pixel-halfbody-v1")


@pytest.mark.asyncio
@pytest.mark.parametrize("version", ["python-agent-v8", "python-agent-v9", "python-agent-v10"])
async def test_layered_avatar_accepts_only_a_pixel_portrait_with_existing_config(version):
    item = replace(layered_pixel_task(), workflow_version=version)
    invalid = [replace(item, portrait_asset_id=None, style_id=None),
               replace(item, config={**item.config, "templateId": "cyber-creator-v1"}),
               replace(item, config=None, brief={"templateId": "pixel-world-v1"}),
               replace(item, style_id="lofi-print-anime")]
    for candidate in invalid:
        client = FakeClient()
        await process_task(candidate, client, FakeProvider(), default_registry(), MemorySaver())
        assert client.failed == ("INVALID_BRIEF", False)
        assert client.writes == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("exists", [True, False])
@pytest.mark.parametrize("version", ["python-agent-v8", "python-agent-v9", "python-agent-v10"])
async def test_layered_avatar_reuses_candidate_or_fails_expired_without_reading_photo(exists, version):
    class CachedClient(FakeClient):
        async def output(self, task):
            return {"assetId": "known-candidate", "exists": exists}

        async def portrait(self, task):
            pytest.fail("a task with an attached output must not read or reclassify its photo")

    item = replace(layered_pixel_task(), workflow_version=version)
    client = CachedClient()
    await process_task(item, client, FakeProvider(), default_registry(), MemorySaver())
    assert client.writes == 0
    assert client.completed == (item.config if exists else None)
    assert client.failed == (None if exists else ("PIXEL_CANDIDATE_EXPIRED", False))


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [True, False])
async def test_v8_stops_after_classification_if_cancelled_or_no_supported_changes(cancel):
    from buildurprofile_agent.contracts import PixelAvatarTraits

    client = FakeClient()

    class Vision:
        async def classify(self, portrait):
            assert portrait.mime == "image/png"
            client.cancelled = cancel
            return PixelAvatarTraits(subject="usable", hair_style="short", hair_color="dark", glasses="none",
                                     headwear="hat", earwear="none", neckwear="choker")

    await process_task(layered_pixel_task(), client, FakeProvider(), default_registry(), MemorySaver(), pixel_vision=Vision())
    assert client.writes == 0 and client.completed is None
    assert client.failed == (None if cancel else ("PIXEL_NO_SUPPORTED_TRAITS", False))


@pytest.mark.asyncio
@pytest.mark.parametrize("subject", ["multiple_people", "no_person", "unclear"])
async def test_v8_unusable_photo_has_no_candidate(subject):
    from buildurprofile_agent.contracts import PixelAvatarTraits

    class Vision:
        async def classify(self, portrait):
            return PixelAvatarTraits(subject=subject, hair_style="long", hair_color="brown", glasses="frames",
                                     headwear="unknown", earwear="unknown", neckwear="unknown")

    client = FakeClient()
    await process_task(layered_pixel_task(), client, FakeProvider(), default_registry(), MemorySaver(), pixel_vision=Vision())
    assert client.writes == 0 and client.completed is None
    assert client.failed == ("PIXEL_PHOTO_UNCLEAR", False)


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
