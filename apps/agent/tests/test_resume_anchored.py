"""The legacy browser parser fixes item boundaries before AI formatting."""

from datetime import datetime, timedelta, timezone

import pytest

from buildurprofile_agent.skills.anchored_formatter import (
    align_anchors, format_anchors, make_anchored_draft,
)


def source(*lines: str) -> dict:
    uploaded = datetime(2026, 11, 9, tzinfo=timezone.utc)
    return {
        "version": "resume-source-v1", "fileId": "file-1", "extractionVersion": "pdf-layout-v1",
        "uploadedAt": uploaded.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expiresAt": (uploaded + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pageCount": 1,
        "blocks": [{"blockId": f"p1_b{index}", "page": 1,
                    "bbox": [20, 10 + index * 20, 200, 25 + index * 20],
                    "fontSize": 12, "bold": False, "readingOrder": index, "text": line}
                   for index, line in enumerate(lines)],
    }


def test_browser_anchor_without_pdfplumber_evidence_cannot_disappear_silently():
    raw = source("项目甲", "完成模型训练")
    plan = {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "projects", "page": 1, "text": "项目甲\n完成模型训练"},
        {"anchorId": "a1", "kind": "awards", "page": 1, "text": "校级创新奖"},
    ]}
    with pytest.raises(ValueError, match="unaligned browser anchor"):
        align_anchors(raw, plan)


class FakeModel:
    def __init__(self, answer: dict):
        self.answer = answer
        self.calls = []

    async def generate_json(self, name: str, schema: dict, prompt: str) -> dict:
        self.calls.append(name)
        return self.answer


@pytest.mark.asyncio
async def test_browser_anchors_keep_a_paragraph_inside_one_project_item():
    raw = source("项目经历", "项目甲 2025.01-2025.06", "完成数据清洗和模型训练",
                 "实现模型部署并验证效果", "校园经历", "学生会主席 2024.09-2025.06",
                 "组织校园活动")
    plan = {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "projects", "page": 1,
         "text": "项目甲 2025.01-2025.06\n完成数据清洗和模型训练\n实现模型部署并验证效果"},
        {"anchorId": "a1", "kind": "campusExperience", "page": 1,
         "text": "学生会主席 2024.09-2025.06\n组织校园活动"},
    ]}
    anchors = align_anchors(raw, plan)
    assert len(anchors) == 2
    assert [anchor["sourceBlockIds"] for anchor in anchors] == [
        ["p1_b0", "p1_b1", "p1_b2", "p1_b3"], ["p1_b4", "p1_b5", "p1_b6"]]
    model = FakeModel({"items": [
        {"anchorId": "a0", "kind": "projects", "title": "项目甲", "details": "- 完成数据清洗和模型训练\n- 实现模型部署并验证效果", "confidence": .9},
        {"anchorId": "a1", "kind": "campusExperience", "title": "学生会主席", "details": "- 组织校园活动", "confidence": .9},
    ]})
    formatted = await format_anchors(raw, anchors, model)
    draft = make_anchored_draft(raw, "resume-1", anchors, formatted)
    assert model.calls == ["resume_format_v1"]
    sections = {section.kind: section for section in draft.sections}
    assert len(sections["projects"].items) == 1
    assert len(sections["campusExperience"].items) == 1
    assert sections["projects"].items[0].details.startswith("- 完成")
    assert not sections["projects"].items[0].included


@pytest.mark.asyncio
async def test_formatter_rejects_a_model_that_splits_one_anchor_into_two_items():
    raw = source("项目甲", "第一句职责", "第二句职责")
    anchors = align_anchors(raw, {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "projects", "page": 1,
         "text": "项目甲\n第一句职责\n第二句职责"}]})
    model = FakeModel({"items": [
        {"anchorId": "a0", "kind": "projects", "title": "项目甲", "details": "第一句职责", "confidence": .95},
        {"anchorId": "a0", "kind": "projects", "title": "项目甲", "details": "第二句职责", "confidence": .95},
    ]})
    with pytest.raises(ValueError, match="anchor|duplicate|format"):
        await format_anchors(raw, anchors, model)


@pytest.mark.asyncio
async def test_only_a_whole_other_anchor_can_move_to_skills():
    raw = source("编程技能", "熟悉 Python 与 SQL")
    anchors = align_anchors(raw, {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "other", "page": 1,
         "text": "编程技能\n熟悉 Python 与 SQL"}]})
    high = FakeModel({"items": [{"anchorId": "a0", "kind": "skills", "title": "编程技能",
                                  "details": "- 熟悉 Python 与 SQL", "confidence": .95}]})
    draft = make_anchored_draft(raw, "resume-1", anchors, await format_anchors(raw, anchors, high))
    assert len(next(section for section in draft.sections if section.kind == "skills").items) == 1
    low = FakeModel({"items": [{"anchorId": "a0", "kind": "skills", "title": "编程技能",
                                 "details": "- 熟悉 Python 与 SQL", "confidence": .6}]})
    with pytest.raises(ValueError, match="kind|confidence"):
        await format_anchors(raw, anchors, low)


@pytest.mark.asyncio
async def test_formatter_rejects_unseen_numeric_claims():
    raw = source("项目甲", "完成模型训练")
    anchors = align_anchors(raw, {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "projects", "page": 1,
         "text": "项目甲\n完成模型训练"}]})
    model = FakeModel({"items": [{"anchorId": "a0", "kind": "projects", "title": "项目甲",
                                  "details": "训练准确率提升 90%", "confidence": .99}]})
    with pytest.raises(ValueError, match="number|source|claim"):
        await format_anchors(raw, anchors, model)


@pytest.mark.asyncio
async def test_formatter_accepts_date_spacing_changes_without_inventing_numbers():
    raw = source("项目甲 2025.01 - 2025.06")
    anchors = align_anchors(raw, {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "projects", "page": 1,
         "text": "项目甲 2025.01 - 2025.06"}]})
    model = FakeModel({"items": [{"anchorId": "a0", "kind": "projects", "title": "项目甲",
                                  "details": "2025.01-2025.06", "confidence": .9}]})
    assert (await format_anchors(raw, anchors, model))[0]["details"] == "2025.01-2025.06"


@pytest.mark.asyncio
async def test_unseen_latin_terms_require_review_without_fragmenting_the_item():
    raw = source("项目甲", "完成模型训练")
    anchors = align_anchors(raw, {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "projects", "page": 1,
         "text": "项目甲\n完成模型训练"}]})
    model = FakeModel({"items": [{"anchorId": "a0", "kind": "projects", "title": "项目甲",
                                  "details": "使用 NewTech 完成模型训练", "confidence": .9}]})
    formatted = await format_anchors(raw, anchors, model)
    draft = make_anchored_draft(raw, "resume-1", anchors, formatted)
    project = next(section for section in draft.sections if section.kind == "projects").items[0]
    assert project.needsReview
    assert len(next(section for section in draft.sections if section.kind == "projects").items) == 1


@pytest.mark.asyncio
async def test_long_anchor_is_retried_until_it_becomes_short_readable_bullets():
    body = "负责模型训练、验证与部署。" * 35
    raw = source("项目甲", body)
    anchors = align_anchors(raw, {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "projects", "page": 1,
         "text": "项目甲\n" + body}]})

    class SequenceModel:
        calls = 0

        async def generate_json(self, name, schema, prompt):
            self.calls += 1
            details = body[:int(len(body) * .9)] if self.calls == 1 else (
                "- 负责模型训练与验证\n- 完成模型部署")
            return {"items": [{"anchorId": "a0", "kind": "projects", "title": "项目甲",
                               "details": details, "confidence": .9}]}

    model = SequenceModel()
    output = await format_anchors(raw, anchors, model)
    assert model.calls == 2
    assert output[0]["details"] == "- 负责模型训练与验证\n- 完成模型部署"


@pytest.mark.asyncio
async def test_basic_name_survives_when_browser_anchor_contains_many_contact_lines():
    profile = "个人主页：https://example.com/" + "a" * 100
    raw = source("林青", profile, "lin@example.com", "电话：13800138000", "所在地：杭州")
    anchors = align_anchors(raw, {"version": "resume-parse-plan-v1", "anchors": [
        {"anchorId": "a0", "kind": "basicInfo", "page": 1,
         "text": f"林青\n{profile}\nlin@example.com\n电话：13800138000\n所在地：杭州"}]})
    model = FakeModel({"items": [{"anchorId": "a0", "kind": "basicInfo", "title": "林青",
                                  "details": "所在地：杭州", "confidence": .9}]})
    draft = make_anchored_draft(raw, "resume-1", anchors, await format_anchors(raw, anchors, model))
    item = next(section for section in draft.sections if section.kind == "basicInfo").items[0]
    assert {fact.key for fact in item.facts} >= {"name", "email", "phone"}
