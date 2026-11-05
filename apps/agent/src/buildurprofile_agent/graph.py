"""Versioned LangGraph workflow for confirmed profile generation."""

from __future__ import annotations

from typing import Any, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from .contracts import clean_brief, clean_config
from .skills.registry import SkillRegistry
from .transport.node_api import AgentTask, NodeAgentClient


WORKFLOW_VERSION = "python-agent-v1"
DESIGN_SKILLS = ("assessment.score.v1", "design.map.v1", "resume.compose.v1")
AVATAR_SKILL = "avatar.wibi.v1"
QA_SKILL = "artifact.qa.v1"


class GenerationState(TypedDict):
    task_id: str
    workflow_version: str
    brief: dict | None
    config: dict | None
    portrait_asset_id: str | None
    style_id: str | None
    output_asset_id: str | None
    skill_plan: NotRequired[list[str]]
    skill_versions: NotRequired[dict[str, str]]
    vector: NotRequired[dict]
    recipe_version: NotRequired[str]
    qa: NotRequired[bool]


def task_input(task: AgentTask) -> GenerationState:
    return {"task_id": task.id, "workflow_version": task.workflow_version,
            "brief": task.brief, "config": task.config,
            "portrait_asset_id": task.portrait_asset_id, "style_id": task.style_id,
            "output_asset_id": task.output_asset_id}


def build_generation_graph(task: AgentTask, client: NodeAgentClient, provider: Any,
                           registry: SkillRegistry, *, checkpointer: Any = None) -> Any:
    async def run_skill(skill_id: str, inputs: dict, state: GenerationState,
                        grants: dict | None = None) -> Any:
        descriptor = registry.describe(skill_id)
        if state["skill_versions"].get(skill_id) != descriptor["version"]:
            raise ValueError("SKILL_VERSION_MISMATCH")
        return await registry.run(skill_id, inputs, grants=grants, usage="preview",
                                  expected_version=descriptor["version"])

    async def validate(state: GenerationState) -> dict:
        await client.check_cancel(task)
        if state["workflow_version"] != WORKFLOW_VERSION or not state["task_id"]:
            raise ValueError("SKILL_VERSION_MISMATCH")
        if bool(state["portrait_asset_id"]) != bool(state["style_id"]):
            raise ValueError("INVALID_BRIEF")
        if bool(state["brief"]) == bool(state["config"]):
            raise ValueError("INVALID_BRIEF")
        return {"brief": clean_brief(state["brief"]) if state["brief"] else None,
                "config": clean_config(state["config"]) if state["config"] else None}

    def plan(state: GenerationState) -> dict:
        skills = list(DESIGN_SKILLS) if state["brief"] else []
        if state["portrait_asset_id"]:
            skills.append(AVATAR_SKILL)
        skills.append(QA_SKILL)
        return {"skill_plan": skills,
                "skill_versions": {skill_id: registry.describe(skill_id)["version"] for skill_id in skills}}

    async def score(state: GenerationState) -> dict:
        result = await run_skill(DESIGN_SKILLS[0], {"answers": state["brief"]["answers"]}, state)
        return {"vector": result["vector"]}

    async def map_design(state: GenerationState) -> dict:
        result = await run_skill(DESIGN_SKILLS[1], {"vector": state["vector"],
                                                     "role": state["brief"]["role"]}, state)
        return {"config": result["config"]}

    async def compose(state: GenerationState) -> dict:
        result = await run_skill(DESIGN_SKILLS[2], {"config": state["config"],
                                                    "content": state["brief"]["content"]}, state)
        return {"config": result["config"]}

    async def avatar(state: GenerationState) -> dict:
        async def existing() -> str | None:
            status = await client.output(task)
            return status.get("assetId") if status.get("exists") else None

        async def output_exists(asset_id: str) -> bool:
            status = await client.output(task)
            return status.get("assetId") == asset_id and bool(status.get("exists"))

        grants = {"read_portrait": lambda: client.portrait(task),
                  "load_recipe": lambda: client.recipe(task),
                  "existing_output": existing,
                  "store_output": lambda image: client.store_output(task, image),
                  "output_exists": output_exists,
                  "image_provider": provider,
                  "check_cancel": lambda: client.check_cancel(task)}
        result = await run_skill(AVATAR_SKILL, {"taskId": task.id, "styleId": task.style_id}, state, grants)
        return {"output_asset_id": result["outputAssetId"],
                "recipe_version": result["recipeVersion"]}

    async def qa(state: GenerationState) -> dict:
        await client.check_cancel(task)
        async def output_exists(asset_id: str) -> bool:
            status = await client.output(task)
            return status.get("assetId") == asset_id and bool(status.get("exists"))
        result = await run_skill(QA_SKILL, {"config": state["config"],
                                               "portraitAssetId": state["portrait_asset_id"],
                                               "styleId": state["style_id"],
                                               "outputAssetId": state["output_asset_id"]}, state,
                                 {"output_exists": output_exists})
        return {"qa": bool(result["ok"])}

    graph = StateGraph(GenerationState)
    graph.add_node("validate", validate)
    graph.add_node("plan", plan)
    graph.add_node("score", score)
    graph.add_node("map_design", map_design)
    graph.add_node("compose", compose)
    graph.add_node("avatar", avatar)
    graph.add_node("qa", qa)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "plan")
    graph.add_conditional_edges("plan", lambda state: "score" if state["brief"] else
                                ("avatar" if state["portrait_asset_id"] else "qa"))
    graph.add_edge("score", "map_design")
    graph.add_edge("map_design", "compose")
    graph.add_conditional_edges("compose", lambda state: "avatar" if state["portrait_asset_id"] else "qa")
    graph.add_edge("avatar", "qa")
    graph.add_edge("qa", END)
    return graph.compile(checkpointer=checkpointer)
