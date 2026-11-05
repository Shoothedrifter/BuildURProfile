import pytest

from buildurprofile_agent.skills.registry import Skill, SkillRegistry, default_registry


def test_registry_rejects_unknown_capability_and_duplicate_id():
    registry = SkillRegistry()
    with pytest.raises(ValueError, match="unapproved"):
        registry.register(Skill("unsafe.shell.v1", "1.0.0", frozenset({"shell"}), True, 1,
                                lambda inputs, grants: None))
    skill = Skill("safe.echo.v1", "1.0.0", frozenset(), True, 1,
                  lambda inputs, grants: inputs)
    registry.register(skill)
    with pytest.raises(ValueError, match="Duplicate"):
        registry.register(skill)


@pytest.mark.asyncio
async def test_wibi_commercial_use_and_unpinned_skills_are_denied():
    registry = default_registry()
    with pytest.raises(PermissionError, match="commercial authorization"):
        await registry.run("avatar.wibi.v1", {}, usage="commercial")
    with pytest.raises(ValueError, match="version mismatch"):
        await registry.run("assessment.score.v1", {}, expected_version="0.9.0")
    with pytest.raises(PermissionError, match="incorrect capabilities"):
        await registry.run("artifact.qa.v1", {"config": {}}, grants={})
