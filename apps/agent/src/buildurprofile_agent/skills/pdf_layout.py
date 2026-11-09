"""Deterministic, private PDF layout evidence extraction."""

from __future__ import annotations

from io import BytesIO

import pdfplumber

from buildurprofile_agent.contracts import ResumeSourceV1


def _page_lines(page):
    words = page.extract_words(extra_attrs=["fontname", "size"], use_text_flow=False)
    rows = []
    for word in sorted(words, key=lambda item: (round(item["top"] / 3), item["x0"])):
        row = next((row for row in rows if abs(row[0]["top"] - word["top"]) <= 3
                    and word["x0"] - row[-1]["x1"] < max(page.width * .12, 35)), None)
        if row is None:
            rows.append([word])
        else:
            row.append(word)
    lines = []
    for row in rows:
        row.sort(key=lambda item: item["x0"])
        text = " ".join(word["text"] for word in row).strip()
        if text:
            lines.append({"text": text, "x0": min(w["x0"] for w in row),
                          "top": min(w["top"] for w in row), "x1": max(w["x1"] for w in row),
                          "bottom": max(w["bottom"] for w in row),
                          "size": max(float(w["size"]) for w in row),
                          "bold": any("bold" in w["fontname"].lower() for w in row)})
    return lines


def _reading_order(lines, width):
    if len(lines) < 3:
        return sorted(lines, key=lambda line: (line["top"], line["x0"]))
    starts = sorted(line["x0"] for line in lines)
    gaps = [(starts[index + 1] - starts[index], index) for index in range(len(starts) - 1)]
    gap, index = max(gaps)
    if gap < width * .25 or index < 1 or len(starts) - index - 1 < 2:
        return sorted(lines, key=lambda line: (line["top"], line["x0"]))
    divider = (starts[index] + starts[index + 1]) / 2
    left = [line for line in lines if line["x0"] < divider]
    right = [line for line in lines if line["x0"] >= divider]
    if any(line["x1"] > divider + width * .08 for line in left):
        return sorted(lines, key=lambda line: (line["top"], line["x0"]))
    return sorted(left, key=lambda line: (line["top"], line["x0"])) + sorted(
        right, key=lambda line: (line["top"], line["x0"]))


def extract_pdf_source(pdf_bytes: bytes, *, file_id: str, uploaded_at: str,
                       expires_at: str) -> ResumeSourceV1:
    if len(pdf_bytes) > 10 * 1024 * 1024 or not pdf_bytes.startswith(b"%PDF-"):
        raise ValueError("PARSE_FAILED: invalid PDF")
    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            if not 1 <= len(pdf.pages) <= 20:
                raise ValueError("PARSE_FAILED: page limit")
            blocks = []
            total_chars = 0
            for page_number, page in enumerate(pdf.pages, 1):
                for index, line in enumerate(_reading_order(_page_lines(page), page.width)):
                    total_chars += len(line["text"])
                    if len(blocks) >= 5000 or len(line["text"]) > 12000 or total_chars > 200000:
                        raise ValueError("PARSE_FAILED: text limit")
                    blocks.append({"blockId": f"p{page_number}_b{index}", "page": page_number,
                                   "bbox": [round(line["x0"], 2), round(line["top"], 2),
                                            round(line["x1"], 2), round(line["bottom"], 2)],
                                   "fontSize": round(line["size"], 2), "bold": line["bold"],
                                   "readingOrder": index, "text": line["text"]})
            if not blocks:
                raise ValueError("PARSE_FAILED: no extractable text")
            return ResumeSourceV1.model_validate({"version": "resume-source-v1", "fileId": file_id,
                "extractionVersion": "pdf-layout-v1", "uploadedAt": uploaded_at,
                "expiresAt": expires_at, "pageCount": len(pdf.pages), "blocks": blocks})
    except ValueError:
        raise
    except Exception:
        raise ValueError("PARSE_FAILED: invalid PDF") from None
