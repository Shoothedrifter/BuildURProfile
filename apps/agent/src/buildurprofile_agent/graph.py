"""Versioned LangGraph workflow for confirmed profile generation."""

from __future__ import annotations

import asyncio
from typing import Any, NotRequired, TypedDict

import httpx
from langgraph.graph import END, START, StateGraph

from . import PIXEL_DETAILED_WORKFLOW, PIXEL_IMAGE_WORKFLOW, PIXEL_LAYERED_HAIR_WORKFLOW, PIXEL_LAYER_WORKFLOW
from .contracts import (
    clean_brief, clean_config, GenerationBriefV2, DesignConfigV2, GenerationBriefV3, DesignConfigV3,
    GenerationBriefV4, DesignConfigV4, PixelAvatarTraits, PixelAvatarTraitsV2, PixelAvatarTraitsV3,
)
from .providers.base import GeneratedImage, ImageProviderError
from .skills.registry import SkillRegistry
from .skills.pixel_avatar import STYLE_ID as PIXEL_STYLE_ID
from .transport.node_api import AgentTask, NodeAgentClient, Portrait


SUPPORTED_WORKFLOWS = ("python-agent-v2", "python-agent-v3", "python-agent-v4", "python-agent-v5", "python-agent-v6",
                       PIXEL_IMAGE_WORKFLOW, PIXEL_LAYER_WORKFLOW, PIXEL_DETAILED_WORKFLOW, PIXEL_LAYERED_HAIR_WORKFLOW)
DESIGN_SKILLS = ("assessment.score.v1", "design.map.v1", "resume.compose.v2")
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


def render_pixel_layers(traits: PixelAvatarTraits) -> GeneratedImage:
    from .skills.pixel_avatar_layers import compose_pixel_avatar, load_pixel_avatar_layers, select_pixel_layers

    layers = load_pixel_avatar_layers()
    selection = select_pixel_layers(traits, layers)
    if selection.is_default:
        raise ImageProviderError("PIXEL_NO_SUPPORTED_TRAITS")
    return compose_pixel_avatar(selection, layers)


def render_detailed_pixel_layers(traits: PixelAvatarTraitsV2) -> GeneratedImage:
    from .skills.pixel_avatar_layers_v2 import render_detailed_pixel_avatar

    image = render_detailed_pixel_avatar(traits)
    if image is None:
        raise ImageProviderError("PIXEL_NO_SUPPORTED_TRAITS")
    return image


def render_layered_hair_pixel_layers(traits: PixelAvatarTraitsV3) -> GeneratedImage:
    from .skills.pixel_avatar_layers_v2 import render_layered_hair_pixel_avatar

    image = render_layered_hair_pixel_avatar(traits)
    if image is None:
        raise ImageProviderError("PIXEL_NO_SUPPORTED_TRAITS")
    return image


def build_generation_graph(task: AgentTask, client: NodeAgentClient, provider: Any,
                           registry: SkillRegistry, *, checkpointer: Any = None, pixel_provider: Any = None,
                           pixel_vision: Any = None, pixel_detailed_vision: Any = None,
                           pixel_layered_hair_vision: Any = None) -> Any:
    layered_workflows = {
        PIXEL_LAYER_WORKFLOW: ("avatar.pixel.v2", pixel_vision, render_pixel_layers),
        PIXEL_DETAILED_WORKFLOW: ("avatar.pixel.v3", pixel_detailed_vision, render_detailed_pixel_layers),
        PIXEL_LAYERED_HAIR_WORKFLOW: ("avatar.pixel.v4", pixel_layered_hair_vision, render_layered_hair_pixel_layers),
    }
    layered = layered_workflows.get(task.workflow_version)
    pixel = layered is not None or task.workflow_version == PIXEL_IMAGE_WORKFLOW
    templated = pixel or task.workflow_version in ("python-agent-v5", "python-agent-v6")
    enriched = templated or task.workflow_version in ("python-agent-v3", "python-agent-v4")
    ordered = templated or task.workflow_version == "python-agent-v4"
    if layered:
        avatar_skill, vision, render = layered
    elif pixel:
        avatar_skill = "avatar.pixel.v1"
    else:
        avatar_skill = "avatar.wibi.v2" if task.workflow_version == "python-agent-v6" else AVATAR_SKILL
    template_skill = "design.template.v2" if pixel else "design.template.v1"
    design_skills = (template_skill, "resume.compose.v5") if templated else (*DESIGN_SKILLS[:2], "resume.compose.v4" if ordered else "resume.compose.v3") if enriched else DESIGN_SKILLS
    qa_skill = "artifact.qa.v4" if templated else "artifact.qa.v3" if ordered else "artifact.qa.v2" if enriched else QA_SKILL

    async def run_skill(skill_id: str, inputs: dict, state: GenerationState,
                        grants: dict | None = None) -> Any:
        descriptor = registry.describe(skill_id)
        if state["skill_versions"].get(skill_id) != descriptor["version"]:
            raise ValueError("SKILL_VERSION_MISMATCH")
        return await registry.run(skill_id, inputs, grants=grants, usage="preview",
                                  expected_version=descriptor["version"])

    async def validate(state: GenerationState) -> dict:
        await client.check_cancel(task)
        if state["workflow_version"] not in SUPPORTED_WORKFLOWS or not state["task_id"]:
            raise ValueError("SKILL_VERSION_MISMATCH")
        if bool(state["portrait_asset_id"]) != bool(state["style_id"]):
            raise ValueError("INVALID_BRIEF")
        if bool(state["brief"]) == bool(state["config"]):
            raise ValueError("INVALID_BRIEF")
        template_id = (state["brief"] or state["config"] or {}).get("templateId")
        if pixel != (template_id == "pixel-world-v1"):
            raise ValueError("INVALID_BRIEF")
        if layered and not state["portrait_asset_id"]:
            raise ValueError("INVALID_BRIEF")
        if pixel and state["portrait_asset_id"] and (state["brief"] or state["style_id"] != PIXEL_STYLE_ID):
            raise ValueError("INVALID_BRIEF")
        if enriched:
            brief_model = GenerationBriefV4 if templated else GenerationBriefV3 if ordered else GenerationBriefV2
            config_model = DesignConfigV4 if templated else DesignConfigV3 if ordered else DesignConfigV2
            if state["brief"]:
                return {"brief": brief_model.model_validate(state["brief"]).model_dump(exclude_none=True), "config": None}
            if not state["portrait_asset_id"]:
                raise ValueError("INVALID_BRIEF")
            return {"brief": None, "config": config_model.model_validate(state["config"]).model_dump(exclude_none=True)}
        return {"brief": clean_brief(state["brief"]) if state["brief"] else None,
                "config": clean_config(state["config"]) if state["config"] else None}

    def plan(state: GenerationState) -> dict:
        skills = list(design_skills) if state["brief"] else []
        if state["portrait_asset_id"]:
            skills.append(avatar_skill)
        skills.append(qa_skill)
        return {"skill_plan": skills,
                "skill_versions": {skill_id: registry.describe(skill_id)["version"] for skill_id in skills}}

    async def score(state: GenerationState) -> dict:
        result = await run_skill(design_skills[0], {"answers": state["brief"]["answers"]}, state)
        return {"vector": result["vector"]}

    async def map_design(state: GenerationState) -> dict:
        result = await run_skill(design_skills[0] if templated else design_skills[1],
                                 {"templateId": state["brief"]["templateId"], "role": state["brief"]["role"]}
                                 if templated else {"vector": state["vector"], "role": state["brief"]["role"]}, state)
        return {"config": result["config"]}

    async def compose(state: GenerationState) -> dict:
        result = await run_skill(design_skills[1] if templated else design_skills[2], {"config": state["config"],
                                                    "content": state["brief"]["content"]}, state)
        return {"config": result["config"]}

    async def avatar(state: GenerationState) -> dict:
        async def read_portrait() -> Portrait:
            try:
                return await client.portrait(task)
            except httpx.HTTPStatusError as error:
                if layered and error.response.status_code == 404:
                    raise ImageProviderError("PIXEL_PHOTO_EXPIRED") from None
                raise

        async def existing() -> str | None:
            status = await client.output(task)
            return status.get("assetId") if status.get("exists") else None

        async def output_exists(asset_id: str) -> bool:
            status = await client.output(task)
            return status.get("assetId") == asset_id and bool(status.get("exists"))

        grants: dict[str, Any] = {"read_portrait": read_portrait,
                  "store_output": lambda image: client.store_output(task, image),
                  "output_exists": output_exists,
                  "check_cancel": lambda: client.check_cancel(task)}
        if layered:
            grants.update({"read_output_status": lambda: client.output(task),
                           "classify_portrait": vision.classify if vision is not None else None,
                           "compose_layers": lambda traits: asyncio.to_thread(render, traits)})
        else:
            grants.update({"load_recipe": lambda: client.recipe(task), "existing_output": existing,
                           "image_provider": pixel_provider if pixel else provider})
            if avatar_skill == "avatar.wibi.v2":
                grants["store_cutout"] = lambda image: client.store_cutout(task, image)
        try:
            result = await run_skill(avatar_skill, {"taskId": task.id, "styleId": task.style_id}, state, grants)
        except TimeoutError:
            if layered:
                raise ImageProviderError("PROVIDER_TIMEOUT") from None
            raise
        return {"output_asset_id": result["outputAssetId"],
                "recipe_version": result["recipeVersion"]}

    async def qa(state: GenerationState) -> dict:
        await client.check_cancel(task)
        async def output_exists(asset_id: str) -> bool:
            status = await client.output(task)
            return status.get("assetId") == asset_id and bool(status.get("exists"))
        if enriched:
            (DesignConfigV4 if templated else DesignConfigV3 if ordered else DesignConfigV2).model_validate(state["config"])
            if state["brief"] and state["config"]["content"] != state["brief"]["content"]:
                raise ValueError("Confirmed content was changed")
        result = await run_skill(qa_skill, {"config": state["config"],
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
    graph.add_conditional_edges("plan", lambda state: ("map_design" if templated else "score") if state["brief"] else
                                ("avatar" if state["portrait_asset_id"] else "qa"))
    graph.add_edge("score", "map_design")
    graph.add_edge("map_design", "compose")
    graph.add_conditional_edges("compose", lambda state: "avatar" if state["portrait_asset_id"] else "qa")
    graph.add_edge("avatar", "qa")
    graph.add_edge("qa", END)
    return graph.compile(checkpointer=checkpointer)
