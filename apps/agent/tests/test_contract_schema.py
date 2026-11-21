import json
from pathlib import Path

from buildurprofile_agent.contracts import DesignConfigV1, GenerationBriefV1


ROOT = Path(__file__).resolve().parents[3] / "packages/contracts/schema"


def test_checked_in_json_contracts_match_python_boundary():
    for filename, model in (("generation-brief.v1.json", GenerationBriefV1),
                            ("design-config.v1.json", DesignConfigV1)):
        assert json.loads((ROOT / filename).read_text()) == model.model_json_schema()


def test_pixel_traits_schema_matches_strict_agent_boundary():
    import pytest
    from pydantic import ValidationError
    from buildurprofile_agent import contracts

    assert hasattr(contracts, "PixelAvatarTraits"), "pixel traits boundary is missing"
    model = contracts.PixelAvatarTraits
    sample = {
        "subject": "usable", "hair_style": "twin_tails", "hair_color": "dark",
        "glasses": "none", "headwear": "unknown", "earwear": "unknown", "neckwear": "choker",
    }
    assert model.model_validate(sample).model_dump() == sample
    with pytest.raises(ValidationError):
        model.model_validate({**sample, "hair_style": "shoulder length"})
    with pytest.raises(ValidationError):
        model.model_validate({**sample, "confidence": 0.9})
    with pytest.raises(ValidationError):
        model.model_validate({key: value for key, value in sample.items() if key != "subject"})
    assert json.loads((ROOT / "pixel-avatar-traits.v1.json").read_text()) == model.model_json_schema()


def test_pixel_traits_v2_schema_matches_strict_agent_boundary():
    import pytest
    from pydantic import ValidationError
    from buildurprofile_agent.contracts import PixelAvatarTraits, PixelAvatarTraitsV2

    sample = {
        "subject": "usable", "hair_length": "shoulder_length", "hair_tie": "single_ponytail",
        "bangs": "straight", "hair_color": "pink", "glasses": "frames", "headwear": "none",
        "earwear": "unknown", "neckwear": "choker",
    }
    assert PixelAvatarTraitsV2.model_validate(sample).model_dump() == sample
    with pytest.raises(ValidationError):
        PixelAvatarTraitsV2.model_validate({**sample, "hair_style": "long"})
    with pytest.raises(ValidationError):
        PixelAvatarTraitsV2.model_validate({**sample, "hair_length": "medium"})
    with pytest.raises(ValidationError):
        PixelAvatarTraitsV2.model_validate({key: value for key, value in sample.items() if key != "bangs"})
    with pytest.raises(ValidationError):
        PixelAvatarTraits.model_validate(sample)
    assert json.loads((ROOT / "pixel-avatar-traits.v2.json").read_text()) == PixelAvatarTraitsV2.model_json_schema()


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


def test_v2_enrichment_boundary_and_legacy_isolation():
    from buildurprofile_agent.contracts import StructuredResumeV2, GenerationBriefV2, DesignConfigV2
    import pytest
    raw = json.loads((ROOT.parent / 'fixtures/resume-enrichment.v2.json').read_text())
    # exclude_none：新增可选字段 sourceText 默认 None，fixture 条目无该键，不参与 round-trip 比较
    assert StructuredResumeV2.model_validate(raw).model_dump(exclude_none=True) == raw
    for filename, model in [('generation-brief.v2.json', GenerationBriefV2), ('design-config.v2.json', DesignConfigV2)]:
        assert json.loads((ROOT / filename).read_text()) == model.model_json_schema()
    raw['sections'][0]['items'][0]['sourceBlockIds'] = ['private']
    with pytest.raises(ValueError):
        StructuredResumeV2.model_validate(raw)


def test_private_resume_draft_v2_schema_and_edit_markers():
    from buildurprofile_agent.contracts import ResumeDraftV2
    import pytest
    raw = json.loads((ROOT.parent / 'fixtures/resume-draft.v1.json').read_text())
    raw['version'] = 'resume-draft-v2'
    for section in raw['sections']:
        for item in section['items']:
            item['editedFields'] = []
    assert json.loads((ROOT / 'resume-draft.v2.json').read_text()) == ResumeDraftV2.model_json_schema()
    assert ResumeDraftV2.model_validate(raw).version == 'resume-draft-v2'
    raw['sections'][0]['items'][0]['editedFields'] = ['sourceBlockIds']
    with pytest.raises(ValueError):
        ResumeDraftV2.model_validate(raw)


def test_private_resume_source_v2_records_ocr_provenance():
    from buildurprofile_agent.contracts import ResumeSourceV2
    import pytest
    raw = json.loads((ROOT.parent / 'fixtures/resume-source.v1.json').read_text())
    raw['version'] = 'resume-source-v2'
    raw['extractionVersion'] = 'pdf-layout-v2'
    for block in raw['blocks']:
        block['sourceType'] = 'pdf'
    assert json.loads((ROOT / 'resume-source.v2.json').read_text()) == ResumeSourceV2.model_json_schema()
    assert ResumeSourceV2.model_validate(raw).blocks[0].sourceType == 'pdf'
    raw['blocks'][0]['sourceType'] = 'ocr'
    raw['blocks'][0]['ocrConfidence'] = 1.1
    with pytest.raises(ValueError):
        ResumeSourceV2.model_validate(raw)


def test_source_text_optional_field_on_contracts():
    # sourceText 为三个合同模型上的可选字段：出现在 properties 且不进入 required
    from buildurprofile_agent.contracts import ProjectCard, ResumeDisplayItem, ResumeDraftItem
    for model in (ResumeDraftItem, ResumeDisplayItem, ProjectCard):
        schema = model.model_json_schema()
        assert "sourceText" in schema["properties"], f"{model.__name__} 缺少 sourceText"
        assert "sourceText" not in schema.get("required", []), f"{model.__name__} 不应将 sourceText 设为必填"
    # draft v2 的 editedFields 标记允许 sourceText
    from buildurprofile_agent.contracts import ResumeDraftV2
    raw = json.loads((ROOT.parent / 'fixtures/resume-draft.v1.json').read_text())
    raw['version'] = 'resume-draft-v2'
    for section in raw['sections']:
        for item in section['items']:
            item['editedFields'] = []
    raw['sections'][0]['items'][0]['editedFields'] = ['sourceText']
    assert ResumeDraftV2.model_validate(raw).sections[0].items[0].editedFields == ['sourceText']


def test_ordered_public_resume_v3_accepts_user_order_and_rejects_private_fields():
    from buildurprofile_agent.contracts import StructuredResumeV3, GenerationBriefV3, DesignConfigV3
    import pytest
    raw = json.loads((ROOT.parent / 'fixtures/resume-enrichment.v3.json').read_text())
    # exclude_none：同 v2，可选字段默认 None 不参与 round-trip 比较
    assert StructuredResumeV3.model_validate(raw).model_dump(exclude_none=True) == raw
    assert raw['sections'][0]['kind'] == 'workExperience'
    for filename, model in [('generation-brief.v3.json', GenerationBriefV3), ('design-config.v3.json', DesignConfigV3)]:
        assert json.loads((ROOT / filename).read_text()) == model.model_json_schema()
    raw['sections'][0]['items'][0]['sourceBlockIds'] = ['private']
    with pytest.raises(ValueError):
        StructuredResumeV3.model_validate(raw)


def test_public_highlights_preserve_three_states_and_reject_private_provenance():
    from buildurprofile_agent.contracts import StructuredResumeV3, GenerationBriefV4, DesignConfigV4
    import pytest

    raw = json.loads((ROOT.parent / 'fixtures/resume-enrichment.v3.json').read_text())
    raw['sections'][0]['kind'] = 'campusExperience'
    item = raw['sections'][0]['items'][0]
    assert StructuredResumeV3.model_validate(raw).model_dump(exclude_none=True) == raw
    item['presentationHighlights'] = []
    assert StructuredResumeV3.model_validate(raw).model_dump(exclude_none=True) == raw
    highlight = {'id': 'registration', 'type': 'campus-metric', 'label': '报名人数降低',
                 'value': '-12', 'unit': '%'}
    item['presentationHighlights'] = [highlight]
    assert StructuredResumeV3.model_validate(raw).model_dump(exclude_none=True) == raw
    item['presentationHighlights'] = [{**highlight, 'sourceBlockId': 'private'}]
    with pytest.raises(ValueError):
        StructuredResumeV3.model_validate(raw)
    item['presentationHighlights'] = [highlight]
    raw['sections'][0]['kind'] = 'awards'
    with pytest.raises(ValueError):
        StructuredResumeV3.model_validate(raw)
    for filename, model in [('generation-brief.v4.json', GenerationBriefV4), ('design-config.v4.json', DesignConfigV4)]:
        assert json.loads((ROOT / filename).read_text()) == model.model_json_schema()


def test_private_highlight_can_move_between_modules_while_unchecked():
    from buildurprofile_agent.contracts import ResumeDraftV2
    import pytest

    raw = json.loads((ROOT.parent / 'fixtures/resume-draft.v1.json').read_text())
    raw['version'] = 'resume-draft-v2'
    for section in raw['sections']:
        for item in section['items']:
            item['editedFields'] = []
    item = raw['sections'][0]['items'][0]
    item['editedFields'].append('presentationHighlights')
    row = {'id': 'registration', 'type': 'campus-metric', 'label': '报名人数降低', 'value': '-12',
           'unit': '%', 'origin': 'source', 'sourceBlockId': item['sourceBlockIds'][0], 'selected': False}
    item['presentationHighlights'] = [row]
    assert ResumeDraftV2.model_validate(raw).sections[0].items[0].presentationHighlights[0].value == '-12'
    row['selected'] = True
    with pytest.raises(ValueError, match='Invalid highlight module'):
        ResumeDraftV2.model_validate(raw)
    row['selected'] = False
    row['sourceBlockId'] = 'another_item'
    with pytest.raises(ValueError, match='Highlight evidence must belong to its item'):
        ResumeDraftV2.model_validate(raw)
