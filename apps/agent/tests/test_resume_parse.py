"""Synthetic, source-grounded resume parsing boundaries."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import pytest

from buildurprofile_agent.skills.pdf_layout import extract_pdf_source
from buildurprofile_agent.skills.section_classifier import classify_sections
from buildurprofile_agent.skills.item_splitter import split_items, make_draft
from buildurprofile_agent.providers.text_model import OpenAIResumeTextModel


def pdf_at(*texts: tuple[int, int, str]) -> bytes:
    """Make a small valid text PDF without real resume material or extra test deps."""
    stream = "\n".join(f"BT /F1 12 Tf {x} {y} Td ({value}) Tj ET" for x, y, value in texts)
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(stream.encode())} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body, offsets = b"%PDF-1.7\n", [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += f"{index} 0 obj\n{obj}\nendobj\n".encode()
    start = len(body)
    body += f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode()
    body += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    body += f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF".encode()
    return body


def pdf_pages(pages: list[list[tuple[int, int, str]]]) -> bytes:
    count = len(pages)
    font_id = 3 + count * 2
    objects = ["<< /Type /Catalog /Pages 2 0 R >>",
               f"<< /Type /Pages /Count {count} /Kids [" +
               " ".join(f"{3 + index * 2} 0 R" for index in range(count)) + "] >>"]
    for index, texts in enumerate(pages):
        stream = "\n".join(f"BT /F1 12 Tf {x} {y} Td ({value}) Tj ET" for x, y, value in texts)
        objects.extend([
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {4 + index * 2} 0 R >>",
            f"<< /Length {len(stream.encode())} >>\nstream\n{stream}\nendstream",
        ])
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    body, offsets = b"%PDF-1.7\n", [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += f"{index} 0 obj\n{obj}\nendobj\n".encode()
    start = len(body)
    body += f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode()
    body += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    body += f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF".encode()
    return body


def source() -> dict:
    now = datetime(2026, 11, 9, tzinfo=timezone.utc)
    return {
        "version": "resume-source-v1", "fileId": "file-1", "extractionVersion": "pdf-layout-v1",
        "uploadedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expiresAt": (now + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pageCount": 1,
        "blocks": [
            {"blockId": "p1_b0", "page": 1, "bbox": [20, 10, 100, 25], "fontSize": 12, "bold": False, "readingOrder": 0, "text": "Jane Doe jane@example.com"},
            {"blockId": "p1_b1", "page": 1, "bbox": [20, 30, 100, 45], "fontSize": 12, "bold": False, "readingOrder": 1, "text": "Work Example Ltd 2024"},
            {"blockId": "p1_b2", "page": 1, "bbox": [20, 50, 100, 65], "fontSize": 12, "bold": False, "readingOrder": 2, "text": "Work Other Ltd 2025"},
            {"blockId": "p1_b3", "page": 1, "bbox": [20, 70, 100, 85], "fontSize": 12, "bold": False, "readingOrder": 3, "text": "Campus Student Union"},
        ],
    }


class FakeModel:
    def __init__(self, answers: list[dict]):
        self.answers = answers
        self.calls: list[str] = []

    async def generate_json(self, name: str, schema: dict, prompt: str) -> dict:
        self.calls.append(name)
        return self.answers.pop(0)


def test_pdf_layout_keeps_column_order_and_stable_evidence_ids():
    data = pdf_at((20, 200, "Left first"), (220, 200, "Right first"),
                  (20, 180, "Left second"), (220, 180, "Right second"))
    first = extract_pdf_source(data, file_id="file-1", uploaded_at="2026-11-09T00:00:00Z",
                               expires_at="2026-12-09T00:00:00Z")
    second = extract_pdf_source(data, file_id="file-1", uploaded_at="2026-11-09T00:00:00Z",
                                expires_at="2026-12-09T00:00:00Z")
    assert [block.text for block in first.blocks] == ["Left first", "Left second", "Right first", "Right second"]
    assert [block.blockId for block in first.blocks] == [block.blockId for block in second.blocks]
    assert all(block.bbox[2] > block.bbox[0] for block in first.blocks)


@pytest.mark.asyncio
async def test_classifier_rejects_invented_or_unassigned_source_blocks():
    fake = FakeModel([{"assignments": [
        {"blockId": "p1_b0", "kind": "basicInfo", "confidence": 0.9},
        {"blockId": "fabricated", "kind": "projects", "confidence": 0.9},
    ]}])
    with pytest.raises(ValueError, match="evidence|block|assignment"):
        await classify_sections(source(), fake)


@pytest.mark.asyncio
async def test_agent_classifies_work_and_campus_separately_and_keeps_low_confidence_unsplit():
    fixture = json.loads((Path(__file__).resolve().parents[3] /
        "packages/contracts/fixtures/resume-parse-golden.v1.json").read_text())
    fake = FakeModel([fixture["sections"], fixture["items"]])
    classified = await classify_sections(source(), fake)
    grouped = await split_items(source(), classified, fake)
    draft = make_draft(source(), "resume-1", classified, grouped)
    assert fake.calls == ["resume_sections_v1", "resume_items_v1"]
    assert len(draft.sections) == 10
    by_kind = {section.kind: section for section in draft.sections}
    assert [item.sourceBlockIds for item in by_kind["workExperience"].items] == [["p1_b1", "p1_b2"]]
    assert by_kind["workExperience"].items[0].needsReview
    assert [item.sourceBlockIds for item in by_kind["campusExperience"].items] == [["p1_b3"]]
    assert len(by_kind["workExperience"].items) == fixture["expected"]["workItems"]
    assert all(not item.included for section in draft.sections for item in section.items)
    basic = by_kind["basicInfo"].items[0]
    assert {fact.key: fact.value for fact in basic.facts}["email"] == "jane@example.com"


@pytest.mark.asyncio
async def test_splitter_rejects_campus_block_grouped_as_work():
    raw = source()
    classified = [
        {"blockId": "p1_b0", "kind": "basicInfo", "confidence": 1.0},
        {"blockId": "p1_b1", "kind": "workExperience", "confidence": 1.0},
        {"blockId": "p1_b2", "kind": "workExperience", "confidence": 1.0},
        {"blockId": "p1_b3", "kind": "campusExperience", "confidence": 1.0},
    ]
    fake = FakeModel([{"groups": [{"kind": "workExperience",
                                    "sourceBlockIds": ["p1_b1", "p1_b2", "p1_b3"],
                                    "confidence": 1.0}]}])
    with pytest.raises(ValueError, match="evidence"):
        await split_items(raw, classified, fake)


@pytest.mark.asyncio
async def test_model_without_configuration_fails_closed(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("RESUME_TEXT_MODEL", raising=False)
    with pytest.raises(ValueError, match="PARSE_FAILED"):
        await OpenAIResumeTextModel().generate_json("test", {"type": "object"}, "data")


@pytest.mark.asyncio
async def test_model_requests_strict_schema_without_storing_response():
    class Responses:
        kwargs = None

        async def create(self, **kwargs):
            self.kwargs = kwargs
            return type("Response", (), {"output_text": '{"ok":true}'})()

    class Client:
        responses = Responses()

    client = Client()
    result = await OpenAIResumeTextModel(model="test-model", client=client).generate_json(
        "resume_sections_v1", {"type": "object"}, "synthetic text")
    assert result == {"ok": True}
    assert client.responses.kwargs["store"] is False
    assert client.responses.kwargs["text"]["format"]["strict"] is True
    assert "tools" not in client.responses.kwargs


def test_pdf_layout_rejects_invalid_or_textless_files():
    with pytest.raises(ValueError, match="PARSE_FAILED"):
        extract_pdf_source(b"bad", file_id="f", uploaded_at="2026-11-09T00:00:00Z",
                           expires_at="2026-12-09T00:00:00Z")
    with pytest.raises(ValueError, match="no extractable text"):
        extract_pdf_source(pdf_at(), file_id="f", uploaded_at="2026-11-09T00:00:00Z",
                           expires_at="2026-12-09T00:00:00Z")


@pytest.mark.asyncio
async def test_cross_page_project_keeps_both_source_blocks_and_high_confidence_split():
    raw = extract_pdf_source(pdf_pages([[(20, 200, "Project Alpha")], [(20, 200, "Result on page two")]]),
                             file_id="file-cross", uploaded_at="2026-11-09T00:00:00Z",
                             expires_at="2026-12-09T00:00:00Z")
    assert [block.blockId for block in raw.blocks] == ["p1_b0", "p2_b0"]
    fake = FakeModel([{"groups": [{"kind": "projects", "sourceBlockIds": ["p1_b0", "p2_b0"],
                                    "confidence": .95}]}])
    classified = [{"blockId": block.blockId, "kind": "projects", "confidence": .9}
                  for block in raw.blocks]
    draft = make_draft(raw, "resume-cross", classified, await split_items(raw, classified, fake))
    project = next(section for section in draft.sections if section.kind == "projects").items[0]
    assert project.sourceBlockIds == ["p1_b0", "p2_b0"]
    assert project.details == "Project Alpha\nResult on page two"
