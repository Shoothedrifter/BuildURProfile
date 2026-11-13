"""Local OCR of pages with no embedded text; never sends PDF bytes to a provider."""

from __future__ import annotations

from io import BytesIO
import math
import re
import subprocess

import pdfplumber
import pypdfium2

from buildurprofile_agent.contracts import ResumeSourceV2
from .pdf_layout import _page_lines, _reading_order


class OcrError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _ocr_lines(image_bytes: bytes, width: float, height: float, *,
               pixels_w: int, pixels_h: int, timeout_seconds: int) -> list[dict]:
    try:
        result = subprocess.run(["tesseract", "stdin", "stdout", "-l", "chi_sim+eng", "tsv"],
                                input=image_bytes, capture_output=True, timeout=timeout_seconds,
                                check=False)
    except FileNotFoundError:
        raise OcrError("OCR_UNAVAILABLE") from None
    except subprocess.TimeoutExpired:
        raise OcrError("OCR_TIMEOUT") from None
    if result.returncode:
        diagnostic = result.stderr.decode("utf-8", errors="replace").lower()
        if "failed loading language" in diagnostic or "error opening data file" in diagnostic:
            raise OcrError("OCR_LANGUAGE_MISSING")
        raise OcrError("OCR_FAILED")
    rows: dict[tuple[str, str, str], list[dict]] = {}
    for line in result.stdout.decode("utf-8", errors="replace").splitlines()[1:]:
        cells = line.split("\t", 11)
        if len(cells) != 12 or cells[0] != "5" or not cells[11].strip():
            continue
        try:
            confidence = float(cells[10])
            x, y, w, h = map(int, cells[6:10])
        except ValueError:
            continue
        if confidence < 0 or w < 1 or h < 1:
            continue
        key = (cells[2], cells[3], cells[4])
        rows.setdefault(key, []).append({"text": cells[11].strip(), "x": x, "y": y,
                                         "w": w, "h": h, "confidence": confidence})
    lines = []
    for words in rows.values():
        words.sort(key=lambda word: word["x"])
        text = " ".join(word["text"] for word in words).strip()
        if not text:
            continue
        x0, top = min(word["x"] for word in words), min(word["y"] for word in words)
        x1 = max(word["x"] + word["w"] for word in words)
        bottom = max(word["y"] + word["h"] for word in words)
        lines.append({"text": text, "bbox": [round(x0 * width / pixels_w, 2),
            round(top * height / pixels_h, 2), round(x1 * width / pixels_w, 2),
            round(bottom * height / pixels_h, 2)],
            "confidence": round(sum(word["confidence"] for word in words) /
                                (100 * len(words)), 3)})
    return sorted(lines, key=lambda line: (line["bbox"][1], line["bbox"][0]))


def ocr_pdf_pages(pdf_bytes: bytes, pages: list[int] | None, timeout_seconds: int = 20,
                  *, file_id: str, uploaded_at: str, expires_at: str) -> ResumeSourceV2:
    """Preserve native text pages and OCR only blank pages. Page numbers are one based."""
    if not pdf_bytes.startswith(b"%PDF-") or len(pdf_bytes) > 10 * 1024 * 1024:
        raise OcrError("OCR_FAILED")
    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)
            if not 1 <= page_count <= 20:
                raise OcrError("OCR_FAILED")
            native = [_reading_order(_page_lines(page), page.width) for page in pdf.pages]
            if any(not math.isfinite(page.width * page.height) or page.width <= 0 or
                   page.height <= 0 or page.width * page.height > 4_000_000
                   for page in pdf.pages):
                raise OcrError("OCR_FAILED")
            blank = {index for index, lines in enumerate(native, 1) if not lines}
            requested = blank if pages is None else set(pages)
            if requested != blank or not requested:
                raise OcrError("OCR_FAILED")
            blocks = []
            document = pypdfium2.PdfDocument(pdf_bytes)
            try:
                for page_number, (page, lines) in enumerate(zip(pdf.pages, native), 1):
                    if page_number in requested:
                        scale = min(2, math.sqrt(8_000_000 / (page.width * page.height)))
                        bitmap = document[page_number - 1].render(scale=scale)
                        try:
                            image = bitmap.to_pil()
                            try:
                                buffer = BytesIO()
                                image.save(buffer, format="PNG")
                                ocr_lines = _ocr_lines(buffer.getvalue(), page.width, page.height,
                                    pixels_w=image.width, pixels_h=image.height,
                                    timeout_seconds=timeout_seconds)
                            finally:
                                image.close()
                        finally:
                            bitmap.close()
                        seen: dict[str, list[list[float]]] = {}
                        ocr_order = 0
                        for line in ocr_lines:
                            normalized = re.sub(r"\s+", "", line["text"]).casefold()
                            if any(all(abs(line["bbox"][axis] - box[axis]) <= 5 for axis in (0, 1))
                                   for box in seen.get(normalized, [])):
                                continue
                            seen.setdefault(normalized, []).append(line["bbox"])
                            blocks.append({"blockId": f"p{page_number}_b{ocr_order}",
                                "page": page_number, "bbox": line["bbox"], "fontSize": 0,
                                "bold": False, "readingOrder": ocr_order,
                                "text": line["text"], "sourceType": "ocr",
                                "ocrConfidence": line["confidence"]})
                            ocr_order += 1
                    else:
                        for order, line in enumerate(lines):
                            blocks.append({"blockId": f"p{page_number}_b{order}",
                                "page": page_number, "bbox": [round(line[key], 2) for key in
                                    ("x0", "top", "x1", "bottom")], "fontSize": round(line["size"], 2),
                                "bold": line["bold"], "readingOrder": order,
                                "text": line["text"], "sourceType": "pdf", "ocrConfidence": None})
            finally:
                document.close()
            if not any(block["sourceType"] == "ocr" for block in blocks):
                raise OcrError("OCR_NO_TEXT")
            if len(blocks) > 5000 or sum(len(block["text"]) for block in blocks) > 200000:
                raise OcrError("OCR_FAILED")
            return ResumeSourceV2.model_validate({"version": "resume-source-v2",
                "fileId": file_id, "extractionVersion": "pdf-layout-v2",
                "uploadedAt": uploaded_at, "expiresAt": expires_at,
                "pageCount": page_count, "blocks": blocks})
    except OcrError:
        raise
    except Exception:
        raise OcrError("OCR_FAILED") from None
