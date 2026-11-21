"""Actual Node HTTP lease → Python LangGraph → Node completion contract."""

import asyncio
import io
import json
import os
from pathlib import Path
import subprocess

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from PIL import Image

from buildurprofile_agent.skills.registry import default_registry
from buildurprofile_agent.providers.openai_images import GeneratedImage
from buildurprofile_agent.transport.node_api import NodeAgentClient
from buildurprofile_agent.worker import process_task, process_resume_task


ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.asyncio
async def test_real_node_bridge_pixel_avatar_stays_private(tmp_path):
    import base64
    import httpx
    from buildurprofile_agent.providers.cloudflare_pixel_vision import CloudflarePixelVisionProviderV2

    token = "p" * 64
    proc = subprocess.Popen(["node", "apps/agent/tests/fixtures/pixel-bridge-server.mjs"], cwd=ROOT,
                            env={**os.environ, "AGENT_SERVICE_TOKEN": token},
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = await asyncio.wait_for(asyncio.to_thread(proc.stdout.readline), timeout=10)
        assert line, proc.stderr.read()
        base = json.loads(line)["baseUrl"]
        config = json.loads((ROOT / "packages/contracts/fixtures/agent-golden.v3.json").read_text())["expected"]["config"]
        config["templateId"] = "pixel-world-v1"
        for section in config["content"]["resume"]["sections"]:
            for key in section["items"]:
                key["supplement"]["images"] = []

        stream = io.BytesIO()
        Image.new("RGB", (512, 512), "#435266").save(stream, format="PNG")
        image_b64 = base64.b64encode(stream.getvalue()).decode()
        requests = []
        choices = {"subject": "usable", "hair_length": "long", "hair_tie": "loose", "bangs": "side_swept",
                   "hair_color": "pink", "glasses": "frames",
                   "headwear": "none", "earwear": "none", "neckwear": "choker"}

        def cloudflare_response(request):
            body = json.loads(request.content)
            assert request.url.path.endswith("/@cf/cloudflare/clef")
            assert len(body["images"]) == 1 and set(body["questions"]) == set(choices)
            requests.append(body["images"][0]["base64"])
            answers = {}
            for key, question in body["questions"].items():
                choice = choices[key]
                answers[key] = {"type": "choice", "choice": choice, "confidence": 1.0,
                                "probabilities": {option: int(option == choice) for option in question["criteria"]}}
            return httpx.Response(200, json={"success": True, "result": {"model": "clef",
                "answers": answers, "usage": {"input_tokens": 100, "output_tokens": 0}}})

        async with (httpx.AsyncClient(base_url=base, trust_env=False) as owner,
                    httpx.AsyncClient(base_url=base, trust_env=False) as other,
                    httpx.AsyncClient(transport=httpx.MockTransport(cloudflare_response)) as cf):
            csrf = (await owner.get("/api/session")).json()["csrfToken"]
            headers = {"x-csrf-token": csrf}
            project = (await owner.post("/api/projects", json={"config": config}, headers=headers)).raise_for_status().json()
            photo = (await owner.post("/api/portraits", json={"dataUrl": f"data:image/png;base64,{image_b64}"},
                                      headers=headers)).raise_for_status().json()
            queued = (await owner.post("/api/generations", json={"config": config, "portraitAssetId": photo["id"],
                                                                "idempotencyKey": "pixel-bridge"},
                                       headers=headers)).raise_for_status().json()
            client = NodeAgentClient(base, token)
            try:
                assert await client.lease("legacy_worker") is None
                assert await client.lease("v8_worker", supports_pixel_layer_avatar=True) is None
                task = await client.lease("pixel_worker", supports_pixel_layer_avatar=True,
                                          supports_pixel_detailed_avatar=True)
                assert task and task.id == queued["id"] and task.workflow_version == "python-agent-v9"
                provider = CloudflarePixelVisionProviderV2(account_id="a" * 32, api_token="test-token", http=cf)
                async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "avatar-checkpoints.sqlite")) as saver:
                    await saver.setup()
                    await process_task(task, client, object(), default_registry(), saver, "pixel_worker",
                                       pixel_detailed_vision=provider)
                    assert len(requests) == 1
                    async for record in saver.alist(None):
                        snapshot = json.dumps(record.checkpoint, default=str)
                        assert image_b64 not in snapshot and requests[0] not in snapshot
                        assert '"hair_length"' not in snapshot and '"bangs"' not in snapshot and '"probabilities"' not in snapshot
            finally:
                await client.close()
            result = (await owner.get(f"/api/generations/{task.id}")).raise_for_status().json()
            assert result["status"] == "SUCCEEDED" and not result.get("projectId")
            url = result["heroArtwork"]["assetUrl"]
            asset = (await owner.get(url)).raise_for_status()
            assert asset.headers["content-type"] == "image/png"
            with Image.open(io.BytesIO(asset.content)) as candidate:
                assert candidate.size == (1254, 1254)
                assert candidate.mode == "RGBA" and candidate.getpixel((0, 0))[3] == 0
                scalp = candidate.crop((450, 160, 800, 260))
                colors = scalp.getcolors(maxcolors=scalp.width * scalp.height)
                assert any(r > g + 30 and b > g + 8 for _, (r, g, b, a) in colors if a == 255)
            await other.get("/api/session")
            assert (await other.get(url)).status_code == 404
            assert (await owner.get(f"/api/projects/{project['id']}")).json() == project
    finally:
        proc.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
            await asyncio.to_thread(proc.wait)


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
                    assert recipe["id"] == "lofi-print-anime"
                    output = io.BytesIO()
                    with Image.open(io.BytesIO(portrait.bytes)) as source:
                        source.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS).save(output, format="PNG")
                    assert len(output.getvalue()) <= 10 * 1024 * 1024
                    return GeneratedImage(output.getvalue())

            provider = MockImageProvider()
            await process_task(photo_task, client, provider, default_registry(), MemorySaver(), "python_integration")
            assert provider.calls == 1
            assert await client.lease("python_integration") is None
            resume_task = await client.lease_resume("python_resume_integration")
            assert resume_task and resume_task.resume_id == endpoint["resumeId"]
            assert (await client.resume_source(resume_task)).startswith(b"%PDF-")
            assert (await client.resume_plan(resume_task))["version"] == "resume-parse-plan-v1"

            class MockTextModel:
                async def generate_json(self, name, schema, prompt):
                    assert name == "resume_format_v1"
                    assert "Synthetic fixture" in prompt
                    return {"items": [{"anchorId": "a0", "kind": "other",
                                       "title": "Synthetic fixture", "details": "Synthetic fixture",
                                       "confidence": .95}]}

            await process_resume_task(resume_task, client, MockTextModel(), default_registry(),
                                      MemorySaver(), "python_resume_integration")
            from buildurprofile_agent.transport.node_api import LeaseLost
            with pytest.raises(LeaseLost):
                await client.resume_source(resume_task)
            assert await client.lease_resume("python_resume_integration") is None
        finally:
            await client.close()
    finally:
        proc.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
            await asyncio.to_thread(proc.wait)


@pytest.mark.asyncio
async def test_real_node_bridge_ocr_private_plan_and_completion(monkeypatch):
    token = "o" * 64
    tsv = ("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
           "5\t1\t1\t1\t1\t1\t20\t30\t120\t18\t64\tSynthetic fixture\n")
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: type("Result", (), {
        "returncode": 0, "stdout": tsv.encode(), "stderr": b""})())
    proc = subprocess.Popen(["node", "apps/agent/tests/fixtures/bridge-server.mjs"], cwd=ROOT,
                            env={**os.environ, "AGENT_SERVICE_TOKEN": token, "AGENT_TEST_OCR": "1"},
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True)
    try:
        line = await asyncio.wait_for(asyncio.to_thread(proc.stdout.readline), timeout=10)
        assert line, proc.stderr.read()
        endpoint = json.loads(line)
        client = NodeAgentClient(endpoint["baseUrl"], token)
        try:
            task = await client.lease_resume("python_ocr_integration")
            assert task and task.workflow_version == "resume-parse-v5" and task.ocr_pages == [1]

            class MockTextModel:
                async def generate_json(self, name, schema, prompt):
                    assert "Synthetic fixture" in prompt
                    return {"items": [{"anchorId": "a0", "kind": "other",
                        "title": "Synthetic fixture", "details": "Synthetic fixture", "confidence": .95}]}

            await process_resume_task(task, client, MockTextModel(), default_registry(),
                                      MemorySaver(), "python_ocr_integration")
            from buildurprofile_agent.transport.node_api import LeaseLost
            with pytest.raises(LeaseLost):
                await client.resume_source(task)
            assert await client.lease_resume("python_ocr_integration") is None
        finally:
            await client.close()
    finally:
        proc.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
            await asyncio.to_thread(proc.wait)


@pytest.mark.asyncio
async def test_resume_transport_keeps_private_protocol_separate_and_fences_old_lease():
    import httpx
    from buildurprofile_agent.transport.node_api import LeaseLost

    requests = []

    def handle(request):
        requests.append(request)
        assert request.url.path.startswith('/_internal/agent/resume-tasks/')
        if request.url.path.endswith('/lease'):
            return httpx.Response(200, json={"id": "parse-task", "leaseToken": "current-lease",
                "workflowVersion": "resume-parse-v2", "resumeId": "resume-one", "fileId": "file-one",
                "pageCount": 1, "uploadedAt": "2026-11-09T00:00:00Z", "expiresAt": "2026-12-09T00:00:00Z"})
        if request.url.path.endswith('/source'):
            assert request.headers['x-agent-lease'] == 'current-lease'
            return httpx.Response(200, content=b'%PDF-synthetic', headers={'content-type': 'application/pdf'})
        if request.url.path.endswith('/plan'):
            assert request.headers['x-agent-lease'] == 'current-lease'
            return httpx.Response(200, json={"version": "resume-parse-plan-v1", "anchors": [
                {"anchorId": "a0", "kind": "other", "page": 1, "text": "Synthetic fixture"}]})
        body = json.loads(request.content)
        if body['leaseToken'] == 'stale':
            return httpx.Response(409, json={'errorCode': 'LEASE_LOST'})
        assert body['leaseToken'] == 'current-lease'
        return httpx.Response(200, json={'ok': True, 'cancelRequested': False})

    async with httpx.AsyncClient(base_url='http://node.test', transport=httpx.MockTransport(handle)) as http:
        client = NodeAgentClient('http://node.test', 's' * 64, http=http)
        task = await client.lease_resume('parse_worker')
        assert task.workflow_version == 'resume-parse-v2'
        assert task.resume_id == 'resume-one' and task.file_id == 'file-one'
        assert (await client.resume_source(task)) == b'%PDF-synthetic'
        assert (await client.resume_plan(task))["anchors"][0]["anchorId"] == "a0"
        assert not (await client.heartbeat_resume(task, stage='extract_layout', progress=10))['cancelRequested']
        source, draft = {'version': 'resume-source-v1'}, {'version': 'resume-draft-v1'}
        assert await client.complete_resume(task, source, draft)
        complete_body = json.loads(requests[-1].content)
        assert complete_body['source'] == source and complete_body['draft'] == draft
        assert await client.fail_resume(task, 'PARSE_FAILED', retryable=True)
        assert await client.ack_cancel_resume(task)
        from dataclasses import replace
        with pytest.raises(LeaseLost):
            await client.heartbeat_resume(replace(task, lease_token='stale'))


@pytest.mark.asyncio
async def test_real_node_v3_bridge_creates_unpaid_project_with_image_references():
    token = 'v' * 64
    proc = subprocess.Popen(['node', 'apps/agent/tests/fixtures/v3-bridge-server.mjs'], cwd=ROOT,
                            env={**os.environ, 'AGENT_SERVICE_TOKEN': token},
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = await asyncio.wait_for(asyncio.to_thread(proc.stdout.readline), timeout=10)
        assert line, proc.stderr.read()
        endpoint = json.loads(line)
        client = NodeAgentClient(endpoint['baseUrl'], token)
        try:
            task = await client.lease('v3_integration')
            assert task and task.workflow_version == 'python-agent-v3'
            await process_task(task, client, object(), default_registry(), MemorySaver(), 'v3_integration')
            line = await asyncio.wait_for(asyncio.to_thread(proc.stdout.readline), timeout=10)
            result = json.loads(line)
            golden = json.loads((ROOT / 'packages/contracts/fixtures/agent-golden.v2.json').read_text())
            assert result['config'] == golden['expected']['config']
            assert result['projectId'] and result['projects'] == 1 and result['paid'] == 0
            assert result['config']['content']['resume']['sections'][0]['items'][0]['supplement']['images'][0]['imageId'] == 'image_synthetic'
            assert await client.lease('v3_integration') is None
        finally:
            await client.close()
    finally:
        proc.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
            await asyncio.to_thread(proc.wait)
