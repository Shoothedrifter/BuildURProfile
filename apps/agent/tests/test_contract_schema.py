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


def test_private_resume_contracts_and_evidence():
    from buildurprofile_agent import contracts
    assert hasattr(contracts, 'ResumeDraftV1'), 'private draft boundary is missing'
    assert hasattr(contracts, 'ResumeSourceV1'), 'private source boundary is missing'
    source = contracts.ResumeSourceV1.model_validate_json((ROOT.parent / 'fixtures/resume-source.v1.json').read_text())
    draft = contracts.ResumeDraftV1.model_validate_json((ROOT.parent / 'fixtures/resume-draft.v1.json').read_text())
    contracts.validate_resume_draft(draft.model_dump(), source)
    import pytest
    raw = draft.model_dump()
    raw['sections'][0]['items'][0]['sourceBlockIds'] = ['missing']
    with pytest.raises(ValueError):
        contracts.validate_resume_draft(raw, source)
    for filename, model in [('resume-source.v1.json', contracts.ResumeSourceV1), ('resume-draft.v1.json', contracts.ResumeDraftV1)]:
        assert json.loads((ROOT / filename).read_text()) == model.model_json_schema()


def test_private_contract_rejects_invalid_modules_limits_dates_and_origin():
    from copy import deepcopy
    from buildurprofile_agent.contracts import ResumeDraftV1, ResumeSourceV1
    import pytest
    draft = json.loads((ROOT.parent / 'fixtures/resume-draft.v1.json').read_text())
    mutations = [lambda d: d['sections'].pop(),
                 lambda d: d['sections'].__setitem__(9, deepcopy(d['sections'][0])),
                 lambda d: d['sections'][0].__setitem__('mappedDesignModule', 'campus-timeline'),
                 lambda d: d['sections'][0]['items'][0].__setitem__('confidence', 1.01),
                 lambda d: d['sections'][0]['items'][0].__setitem__('title', 'x' * 301),
                 lambda d: d['sections'][0]['items'][0].__setitem__('sourceBlockIds', []),
                 lambda d: d.__setitem__('resumeId', '../unsafe'),
                 lambda d: d.__setitem__('extra', 'private')]
    for mutate in mutations:
        raw = deepcopy(draft)
        mutate(raw)
        with pytest.raises(ValueError):
            ResumeDraftV1.model_validate(raw)
    draft['sections'][0]['items'][0].update(origin='user', sourceBlockIds=[])
    assert ResumeDraftV1.model_validate(draft)
    source = json.loads((ROOT.parent / 'fixtures/resume-source.v1.json').read_text())
    for date in ['2026-12-10T00:00:00Z', '2026-02-30T00:00:00Z']:
        with pytest.raises(ValueError):
            ResumeSourceV1.model_validate({**source, 'expiresAt': date})
