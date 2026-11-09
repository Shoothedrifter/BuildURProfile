"""Private LangGraph workflow for PDF resume parsing.

The graph state contains only task metadata. PDF bytes, extracted text, model
prompts and draft evidence live in this invocation's closure, never in a saver.
"""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from buildurprofile_agent.contracts import RESUME_MODULE_MAPPING, validate_resume_draft
from buildurprofile_agent.skills.item_splitter import make_draft
from buildurprofile_agent.skills.pdf_layout import extract_pdf_source
from buildurprofile_agent.skills.registry import SkillRegistry, default_registry
from buildurprofile_agent.transport.node_api import CancelRequested, ResumeParseTask


WORKFLOW_VERSION = "resume-parse-v1"
NODES = ("validate_source", "extract_layout", "classify_sections", "map_design_modules",
         "split_items", "verify_evidence", "complete_draft")


class ResumeParseState(TypedDict):
    task_id: str
    file_id: str
    resume_id: str
    workflow_version: str
    stage: str


class ResumeParseRun:
    def __init__(self):
        self.graph: Any = None
        self.source: Any = None
        self.draft: Any = None


def build_resume_parse_graph(task: ResumeParseTask, client: Any, model: Any,
                             registry: SkillRegistry | None = None, *,
                             checkpointer: Any = None) -> ResumeParseRun:
    registry = registry or default_registry()
    run = ResumeParseRun()
    private: dict[str, Any] = {}

    async def progress(stage: str, count: int) -> dict:
        status = await client.heartbeat_resume(task, stage=stage, progress=count)
        if status.get("cancelRequested"):
            raise CancelRequested("Resume parsing was cancelled")
        return {"stage": stage}

    async def validate_source(state: ResumeParseState) -> dict:
        if (state["task_id"] != task.id or state["file_id"] != task.file_id
                or state["resume_id"] != task.resume_id
                or state["workflow_version"] != WORKFLOW_VERSION):
            raise ValueError("SKILL_VERSION_MISMATCH")
        await progress("validate_source", 5)
        private["pdf"] = await client.resume_source(task)
        if not private["pdf"].startswith(b"%PDF-") or len(private["pdf"]) > 10 * 1024 * 1024:
            raise ValueError("PARSE_FAILED: invalid PDF")
        return {"stage": "validate_source"}

    async def extract_layout(_: ResumeParseState) -> dict:
        run.source = extract_pdf_source(private.pop("pdf"), file_id=task.file_id,
            uploaded_at=task.uploaded_at, expires_at=task.expires_at)
        if run.source.pageCount != task.page_count:
            raise ValueError("PARSE_FAILED: PDF page count mismatch")
        return await progress("extract_layout", 20)

    async def classify_sections(_: ResumeParseState) -> dict:
        descriptor = registry.describe("resume.sections.v1")
        private["classified"] = await registry.run("resume.sections.v1", {"source": run.source},
            grants={"text_model": model}, expected_version=descriptor["version"])
        return await progress("classify_sections", 45)

    async def map_design_modules(_: ResumeParseState) -> dict:
        if len(RESUME_MODULE_MAPPING) != 10:
            raise ValueError("SKILL_VERSION_MISMATCH")
        return await progress("map_design_modules", 50)

    async def split_items(_: ResumeParseState) -> dict:
        descriptor = registry.describe("resume.items.v1")
        private["grouped"] = await registry.run("resume.items.v1", {"source": run.source,
            "classified": private["classified"]}, grants={"text_model": model},
            expected_version=descriptor["version"])
        return await progress("split_items", 75)

    async def verify_evidence(_: ResumeParseState) -> dict:
        run.draft = make_draft(run.source, task.resume_id, private.pop("classified"),
                               private.pop("grouped"))
        validate_resume_draft(run.draft, run.source)
        return await progress("verify_evidence", 90)

    async def complete_draft(_: ResumeParseState) -> dict:
        if run.source is None or run.draft is None:
            raise ValueError("PARSE_FAILED: incomplete draft")
        return await progress("complete_draft", 95)

    nodes = {"validate_source": validate_source, "extract_layout": extract_layout,
             "classify_sections": classify_sections, "map_design_modules": map_design_modules,
             "split_items": split_items, "verify_evidence": verify_evidence,
             "complete_draft": complete_draft}
    graph = StateGraph(ResumeParseState)
    for name, handler in nodes.items():
        graph.add_node(name, handler)
    graph.add_edge(START, NODES[0])
    for current, following in zip(NODES, NODES[1:]):
        graph.add_edge(current, following)
    graph.add_edge(NODES[-1], END)
    run.graph = graph.compile(checkpointer=checkpointer)
    return run
