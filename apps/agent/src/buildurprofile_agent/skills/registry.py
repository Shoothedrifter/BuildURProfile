"""Application-owned Skills with explicit capability grants and licence policy."""

from __future__ import annotations

import asyncio
import inspect
import re
import time
from dataclasses import dataclass
from typing import Any, Callable

from .assessment import score_answers
from .design import style_to_config
from .resume import compose_resume
from .avatar import generate_avatar
from .artifact import verify_artifact


KNOWN_CAPABILITIES = frozenset({
    "read_portrait", "load_recipe", "existing_output", "store_output", "output_exists",
    "image_provider", "check_cancel",
})


@dataclass(frozen=True)
class Skill:
    id: str
    version: str
    capabilities: frozenset[str]
    commercial_allowed: bool
    timeout_seconds: float
    execute: Callable[[dict, dict[str, Any]], Any]


class SkillRegistry:
    def __init__(self) -> None:
        self._skills: dict[str, Skill] = {}

    def register(self, skill: Skill) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9.-]+\.v\d+", skill.id):
            raise ValueError("Invalid Skill ID")
        if skill.id in self._skills or not skill.version or skill.timeout_seconds <= 0:
            raise ValueError("Duplicate or invalid Skill")
        if not skill.capabilities <= KNOWN_CAPABILITIES:
            raise ValueError("Skill requests unapproved capabilities")
        self._skills[skill.id] = skill

    def describe(self, skill_id: str) -> dict:
        skill = self._skills[skill_id]
        return {"id": skill.id, "version": skill.version, "capabilities": sorted(skill.capabilities),
                "commercialAllowed": skill.commercial_allowed, "timeoutSeconds": skill.timeout_seconds}

    async def run(self, skill_id: str, inputs: dict, *, grants: dict[str, Any] | None = None,
                  usage: str = "preview", expected_version: str | None = None) -> Any:
        skill = self._skills[skill_id]
        if expected_version is not None and expected_version != skill.version:
            raise ValueError(f"Skill {skill_id} version mismatch")
        if usage == "commercial" and not skill.commercial_allowed:
            raise PermissionError(f"Skill {skill_id} requires commercial authorization")
        provided = grants or {}
        if set(provided) != skill.capabilities:
            raise PermissionError(f"Skill {skill_id} received incorrect capabilities")
        started = time.monotonic()
        result = skill.execute(inputs, {key: provided[key] for key in skill.capabilities})
        if inspect.isawaitable(result):
            result = await asyncio.wait_for(result, timeout=skill.timeout_seconds)
        elif time.monotonic() - started > skill.timeout_seconds:
            raise TimeoutError(f"Skill {skill_id} timed out")
        return result


def default_registry() -> SkillRegistry:
    registry = SkillRegistry()
    registry.register(Skill("assessment.score.v1", "1.0.0", frozenset(), True, 1.0,
                            lambda inputs, _: {"vector": score_answers(inputs["answers"])}))
    registry.register(Skill("design.map.v1", "1.0.0", frozenset(), True, 1.0,
                            lambda inputs, _: {"config": style_to_config(inputs["vector"], inputs["role"])}))
    registry.register(Skill("resume.compose.v1", "1.0.0", frozenset(), True, 1.0, compose_resume))
    registry.register(Skill("avatar.wibi.v1", "1.0.0", frozenset({"read_portrait", "load_recipe", "existing_output",
        "store_output", "output_exists", "image_provider", "check_cancel"}), False, 30 * 60.0, generate_avatar))
    registry.register(Skill("artifact.qa.v1", "1.0.0", frozenset({"output_exists"}), True, 5.0, verify_artifact))
    return registry
