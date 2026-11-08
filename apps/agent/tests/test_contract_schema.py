import json
from pathlib import Path

from buildurprofile_agent.contracts import DesignConfigV1, GenerationBriefV1


ROOT = Path(__file__).resolve().parents[3] / "packages/contracts/schema"


def test_checked_in_json_contracts_match_python_boundary():
    for filename, model in (("generation-brief.v1.json", GenerationBriefV1),
                            ("design-config.v1.json", DesignConfigV1)):
        assert json.loads((ROOT / filename).read_text()) == model.model_json_schema()


def test_structured_resume_is_accepted_without_source_excerpts():
    resume = {"version": "resume-v1", "basicInfo": [{"key": "name", "label": "姓名", "value": "张三"}],
              "jobIntent": [], "selfEvaluation": [], "education": [], "workExperience": [], "projects": [],
              "awards": [{"title": "创新奖", "details": "2023 创新奖", "facts": []}],
              "campusExperience": [], "skills": [], "other": []}
    from pydantic import ValidationError
    import pytest
    payload = {"role": "frontend-creative-developer", "answers": {
        "e-presence": 2, "e-type": 2, "k-pace": 2, "k-cards": 2, "p-tone": 1,
        "p-strength": 2, "s-browse": 2, "s-control": 2},
        "content": {"profile": {"name": "张三", "role": "", "location": "", "availability": "", "intro": "", "summary": "", "email": ""},
                    "expertise": {"eyebrow": "", "headline": "", "summary": "", "skills": [], "disciplines": []},
                    "projects": [], "resume": resume}}
    assert GenerationBriefV1.model_validate(payload).content.resume.awards[0].title == "创新奖"
    with pytest.raises(ValidationError):
        GenerationBriefV1.model_validate({**payload, "content": {**payload["content"], "resume": {
            **resume, "awards": [{**resume["awards"][0], "source": "PDF text"}]}}})
