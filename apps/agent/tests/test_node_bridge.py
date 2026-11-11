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
from buildurprofile_agent.worker import process_task, process_resume_task


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
