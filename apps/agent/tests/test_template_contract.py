"""A template choice must be an explicit, versioned generation input."""

import json
from pathlib import Path
import subprocess

import pytest
from pydantic import ValidationError

from buildurprofile_agent.contracts import GenerationBriefV4, DesignConfigV4, DesignConfigV3
from buildurprofile_agent.skills.design import template_to_config


ROOT = Path(__file__).resolve().parents[3]


def test_v4_brief_accepts_template_without_answers_and_rejects_extra_fields():
    from buildurprofile_agent.contracts import ResumeContentV3
    resume = json.loads((ROOT / "packages/contracts/fixtures/resume-enrichment.v3.json").read_text())
    content = {"profile": {key: "" for key in ("name", "role", "location", "availability", "intro", "summary", "email")},
               "expertise": {"eyebrow": "", "headline": "", "summary": "", "skills": [], "disciplines": []},
               "projects": [], "resume": resume}
    content["profile"]["name"] = "合成用户"
    assert ResumeContentV3.model_validate(content)
    brief = {"role": "ui-ux-designer", "templateId": "cyber-creator-v1", "content": content}
    assert GenerationBriefV4.model_validate(brief).templateId == "cyber-creator-v1"
    for mutation in ({"templateId": "unknown"}, {"answers": {}}, {"html": "<script />"}):
        with pytest.raises(ValidationError):
            GenerationBriefV4.model_validate({**brief, **mutation})


def test_v4_config_is_explicit_and_old_v3_remains_valid():
    old = json.loads((ROOT / "packages/contracts/fixtures/agent-golden.v3.json").read_text())
    config = old["expected"]["config"]
    assert DesignConfigV3.model_validate(config)
    assert DesignConfigV4.model_validate({**config, "templateId": "cyber-creator-v1"}).templateId == "cyber-creator-v1"
    with pytest.raises(ValidationError):
        DesignConfigV4.model_validate({**config, "templateId": "unlisted"})


def test_pixel_world_contract_round_trips():
    config = json.loads((ROOT / "packages/contracts/fixtures/agent-golden.v3.json").read_text())["expected"]["config"]
    content = {**config["content"], "resume": json.loads(
        (ROOT / "packages/contracts/fixtures/resume-enrichment.v3.json").read_text())}
    brief = {"role": "frontend-creative-developer", "templateId": "pixel-world-v1", "content": content}
    assert GenerationBriefV4.model_validate(brief).templateId == "pixel-world-v1"
    assert DesignConfigV4.model_validate({**config, "templateId": "pixel-world-v1", "content": content}).templateId == "pixel-world-v1"
    with pytest.raises(ValidationError):
        DesignConfigV4.model_validate({**config, "templateId": "pixel-world-v1",
                                       "content": {key: value for key, value in content.items() if key != "resume"}})


def test_warm_macaron_template_registers_with_optional_hero_photo():
    config = template_to_config("warm-macaron-v1", "ui-ux-designer")
    assert config["templateId"] == "warm-macaron-v1"
    assert config["styleVector"] == {"E": 0.75, "K": 0.5, "P": 0.5, "S": 0.5, "PChoice": "warm"}
    # 存量回归：warm-v1 仍可映射
    assert template_to_config("warm-v1", "ui-ux-designer")["templateId"] == "warm-v1"
    golden = json.loads((ROOT / "packages/contracts/fixtures/agent-golden.v3.json").read_text())["expected"]["config"]
    with_hero = {**golden, "templateId": "warm-macaron-v1",
                 "heroPhoto": {"assetUrl": "data:image/png;base64,x", "alt": "测试"}}
    validated = DesignConfigV4.model_validate(with_hero)
    assert (validated.heroPhoto.assetUrl, validated.heroPhoto.alt) == ("data:image/png;base64,x", "测试")
    # heroPhoto 缺省亦可（Agent 不产出该字段）
    assert DesignConfigV4.model_validate({**golden, "templateId": "warm-macaron-v1"}).heroPhoto is None


def test_template_mapping_parity_and_schema_files():
    script = """import { templateToConfig } from './packages/skills/src/mapping.ts';
      const ids=['cyber-creator-v1','pixel-world-v1','warm-v1','warm-macaron-v1','minimal-v1','bold-v1'];
      const roles=['ui-ux-designer','frontend-creative-developer','brand-motion-copy'];
      process.stdout.write(JSON.stringify(ids.flatMap(id=>roles.map(role=>({id,role,config:templateToConfig(id,role)})))));"""
    cases = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT,
                                      capture_output=True, text=True, check=True).stdout)
    for case in cases:
        assert template_to_config(case["id"], case["role"]) == case["config"]
    assert len(cases) == 18
    pixel = template_to_config("pixel-world-v1", "frontend-creative-developer")
    assert (pixel["templateId"], pixel["skin"], pixel["marquee"]["speed"]) == ("pixel-world-v1", "dark-tech", 55)
    for filename, model in (("generation-brief.v4.json", GenerationBriefV4), ("design-config.v4.json", DesignConfigV4)):
        assert json.loads((ROOT / "packages/contracts/schema" / filename).read_text()) == model.model_json_schema()
