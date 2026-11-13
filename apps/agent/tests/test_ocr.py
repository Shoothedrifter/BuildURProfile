"""Synthetic OCR source evidence and explicit failure mapping."""

from types import SimpleNamespace
import subprocess

import pytest

from buildurprofile_agent.skills.ocr import OcrError, ocr_pdf_pages
from test_resume_parse import pdf_pages


TSV = ("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
       "5\t1\t1\t1\t1\t1\t20\t30\t80\t18\t58\tJane Doe\n"
       "5\t1\t1\t1\t2\t1\t20\t55\t80\t18\t93\tjane@example.com\n"
       "5\t1\t1\t1\t3\t1\t20\t80\t80\t18\t90\tjane@example.com\n"
       "5\t1\t1\t1\t4\t1\t20\t56\t80\t18\t89\tjane@example.com\n")
META = {"file_id": "file-1", "uploaded_at": "2026-11-09T00:00:00Z",
        "expires_at": "2026-12-09T00:00:00Z"}


def test_ocr_reads_only_blank_page_and_marks_low_confidence(monkeypatch):
    called = []

    def fake_run(argv, **options):
        called.append((argv, options))
        return SimpleNamespace(returncode=0, stdout=TSV.encode(), stderr=b"")

    monkeypatch.setattr(subprocess, "run", fake_run)
    document = pdf_pages([[(20, 200, "Native text")], []])
    source = ocr_pdf_pages(document, [2], **META)
    assert len(called) == 1
    assert called[0][0] == ["tesseract", "stdin", "stdout", "-l", "chi_sim+eng", "tsv"]
    assert called[0][1]["input"].startswith(b"\x89PNG")
    assert called[0][1]["timeout"] == 20
    assert [block.sourceType for block in source.blocks] == ["pdf", "ocr", "ocr", "ocr"]
    assert source.blocks[1].ocrConfidence == .58
    assert [block.page for block in source.blocks] == [1, 2, 2, 2]
    assert len([block for block in source.blocks if block.text == "jane@example.com"]) == 2


@pytest.mark.parametrize("failure,code", [
    (FileNotFoundError(), "OCR_UNAVAILABLE"),
    (subprocess.TimeoutExpired("tesseract", 1), "OCR_TIMEOUT"),
])
def test_ocr_runtime_failures_are_specific(monkeypatch, failure, code):
    def fake_run(*args, **kwargs):
        raise failure
    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(OcrError, match=code):
        ocr_pdf_pages(pdf_pages([[]]), [1], **META)


def test_ocr_requires_language_packs_and_text(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: SimpleNamespace(
        returncode=1, stdout=b"", stderr=b"Error opening data file chi_sim"))
    with pytest.raises(OcrError, match="OCR_LANGUAGE_MISSING"):
        ocr_pdf_pages(pdf_pages([[]]), [1], **META)
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: SimpleNamespace(
        returncode=0, stdout=TSV.splitlines()[0].encode(), stderr=b""))
    with pytest.raises(OcrError, match="OCR_NO_TEXT"):
        ocr_pdf_pages(pdf_pages([[]]), [1], **META)
