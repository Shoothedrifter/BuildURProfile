"""Resume parse graph keeps private source outside checkpoint state."""

import pytest
from langgraph.checkpoint.memory import MemorySaver

from buildurprofile_agent.graphs.resume_parse import build_resume_parse_graph
from buildurprofile_agent.skills.registry import default_registry
from buildurprofile_agent.transport.node_api import ResumeParseTask
from buildurprofile_agent.worker import process_resume_task
from test_resume_parse import pdf_at


class FakeClient:
    def __init__(self, data):
        self.data = data
        self.stages = []
        self.completed = None
        self.failed = None
        self.cancel_requested = False
        self.plan_read = False

    async def resume_source(self, task):
        return self.data

    async def resume_plan(self, task):
        self.plan_read = True
        anchors = [
            {"anchorId": "a0", "kind": "basicInfo", "page": 1,
             "text": "Jane Doe jane@example.com"},
        ]
        if b"Campus Student Union" in self.data:
            anchors.append({"anchorId": "a1", "kind": "campusExperience", "page": 1,
                            "text": "Campus Student Union"})
        return {"version": "resume-parse-plan-v1", "anchors": anchors}

    async def heartbeat_resume(self, task, *, stage=None, progress=None):
        self.stages.append(stage)
        return {"ok": True, "cancelRequested": self.cancel_requested}

    async def touch_worker(self, worker_id):
        return None

    async def complete_resume(self, task, source, draft):
        self.completed = (source, draft)
        return True

    async def fail_resume(self, task, code, *, retryable):
        self.failed = code
        return True

    async def ack_cancel_resume(self, task):
        self.failed = "CANCELLED"
        return True


class FakeModel:
    async def generate_json(self, name, schema, prompt):
        assert name == "resume_format_v1"
        return {"items": [
            {"anchorId": "a0", "kind": "basicInfo", "title": "Jane Doe",
             "details": "jane@example.com", "confidence": .95},
            {"anchorId": "a1", "kind": "campusExperience", "title": "Campus Student Union",
             "details": "Campus Student Union", "confidence": .9},
        ]}


@pytest.mark.asyncio
async def test_resume_graph_uses_browser_anchors_and_persists_only_metadata():
    task = ResumeParseTask("task-1", "lease-1", "resume-parse-v2", "resume-1", "file-1", 1,
                           "2026-11-09T00:00:00Z", "2026-12-09T00:00:00Z")
    client = FakeClient(pdf_at((20, 200, "Jane Doe jane@example.com"),
                               (20, 180, "Campus Student Union")))
    saver = MemorySaver()
    run = build_resume_parse_graph(task, client, FakeModel(), checkpointer=saver)
    config = {"configurable": {"thread_id": "test-resume"}}
    state = await run.graph.ainvoke({"task_id": task.id, "file_id": task.file_id,
                                     "resume_id": task.resume_id, "workflow_version": task.workflow_version,
                                     "stage": "queued"}, config=config)
    assert state["stage"] == "complete_draft"
    assert len(client.stages) == 7
    assert "format_items" in client.stages
    assert client.plan_read
    assert len(run.draft.sections) == 10
    assert run.source.fileId == task.file_id
    assert "Jane Doe" not in str(state)
    assert "Jane Doe" not in str(saver.storage)


@pytest.mark.asyncio
async def test_worker_completes_resume_draft():
    task = ResumeParseTask("task-2", "lease-2", "resume-parse-v2", "resume-2", "file-2", 1,
                           "2026-11-09T00:00:00Z", "2026-12-09T00:00:00Z")
    client = FakeClient(pdf_at((20, 200, "Jane Doe jane@example.com"),
                               (20, 180, "Campus Student Union")))
    await process_resume_task(task, client, FakeModel(), default_registry(), MemorySaver())
    assert client.completed[1]["resumeId"] == "resume-2"
    assert client.failed is None


@pytest.mark.asyncio
async def test_worker_reports_model_failure_without_saving_draft():
    class BadModel:
        called = False

        async def generate_json(self, name, schema, prompt):
            self.called = True
            raise ValueError("PARSE_FAILED: model unavailable")

    task = ResumeParseTask("task-3", "lease-3", "resume-parse-v2", "resume-3", "file-3", 1,
                           "2026-11-09T00:00:00Z", "2026-12-09T00:00:00Z")
    client = FakeClient(pdf_at((20, 200, "Jane Doe jane@example.com")))
    bad = BadModel()
    await process_resume_task(task, client, bad, default_registry(), MemorySaver())
    assert bad.called
    assert client.completed is None
    assert client.failed == "PARSE_FAILED"


@pytest.mark.asyncio
async def test_cancelled_resume_does_not_complete():
    task = ResumeParseTask("task-4", "lease-4", "resume-parse-v2", "resume-4", "file-4", 1,
                           "2026-11-09T00:00:00Z", "2026-12-09T00:00:00Z")
    client = FakeClient(pdf_at((20, 200, "Jane Doe jane@example.com")))
    client.cancel_requested = True
    await process_resume_task(task, client, FakeModel(), default_registry(), MemorySaver())
    assert client.completed is None
    assert client.failed == "CANCELLED"
