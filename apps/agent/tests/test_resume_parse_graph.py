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

    async def resume_source(self, task):
        return self.data

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
        if name == "resume_sections_v1":
            return {"assignments": [{"blockId": "p1_b0", "kind": "basicInfo", "confidence": .95},
                                    {"blockId": "p1_b1", "kind": "campusExperience", "confidence": .95}]}
        return {"groups": [{"kind": "campusExperience", "sourceBlockIds": ["p1_b1"],
                            "confidence": .9}]}


@pytest.mark.asyncio
async def test_resume_graph_runs_seven_nodes_and_persists_only_metadata():
    task = ResumeParseTask("task-1", "lease-1", "resume-parse-v1", "resume-1", "file-1", 1,
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
    assert len(run.draft.sections) == 10
    assert run.source.fileId == task.file_id
    assert "Jane Doe" not in str(state)
    assert "Jane Doe" not in str(saver.storage)


@pytest.mark.asyncio
async def test_worker_completes_resume_draft():
    task = ResumeParseTask("task-2", "lease-2", "resume-parse-v1", "resume-2", "file-2", 1,
                           "2026-11-09T00:00:00Z", "2026-12-09T00:00:00Z")
    client = FakeClient(pdf_at((20, 200, "Jane Doe jane@example.com"),
                               (20, 180, "Campus Student Union")))
    await process_resume_task(task, client, FakeModel(), default_registry(), MemorySaver())
    assert client.completed[1]["resumeId"] == "resume-2"
    assert client.failed is None


@pytest.mark.asyncio
async def test_worker_reports_model_failure_without_saving_draft():
    class BadModel:
        async def generate_json(self, name, schema, prompt):
            raise ValueError("PARSE_FAILED: model unavailable")

    task = ResumeParseTask("task-3", "lease-3", "resume-parse-v1", "resume-3", "file-3", 1,
                           "2026-11-09T00:00:00Z", "2026-12-09T00:00:00Z")
    client = FakeClient(pdf_at((20, 200, "Jane Doe jane@example.com")))
    await process_resume_task(task, client, BadModel(), default_registry(), MemorySaver())
    assert client.completed is None
    assert client.failed == "PARSE_FAILED"


@pytest.mark.asyncio
async def test_cancelled_resume_does_not_complete():
    task = ResumeParseTask("task-4", "lease-4", "resume-parse-v1", "resume-4", "file-4", 1,
                           "2026-11-09T00:00:00Z", "2026-12-09T00:00:00Z")
    client = FakeClient(pdf_at((20, 200, "Jane Doe jane@example.com")))
    client.cancel_requested = True
    await process_resume_task(task, client, FakeModel(), default_registry(), MemorySaver())
    assert client.completed is None
    assert client.failed == "CANCELLED"
