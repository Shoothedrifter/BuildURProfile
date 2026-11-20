"""Cloudflare Workers AI FLUX.2 Klein 4B multipart image adapter."""

from __future__ import annotations

import base64
import io
import os
import re
from urllib.parse import urlparse

import httpx
from PIL import Image, ImageOps

from ..transport.node_api import Portrait
from .base import GeneratedImage, ImageProviderError


MODEL = "@cf/black-forest-labs/flux-2-klein-4b"
API_ROOT = "https://api.cloudflare.com/client/v4/accounts"
INPUT_MAX_EDGE = 480  # Cloudflare requires each reference image to be smaller than 512×512.
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def _reference_png(data: bytes, mime: str) -> bytes:
    if mime not in ("image/png", "image/jpeg", "image/webp") or len(data) > MAX_IMAGE_BYTES:
        raise ImageProviderError("PROVIDER_REJECTED")
    try:
        with Image.open(io.BytesIO(data)) as source:
            source.verify()
        with Image.open(io.BytesIO(data)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((INPUT_MAX_EDGE, INPUT_MAX_EDGE), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="PNG")
            return output.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageProviderError("PROVIDER_REJECTED") from exc


def _cutout_png(image: GeneratedImage) -> bytes:
    if image.mime not in ("image/png", "image/jpeg", "image/webp") or len(image.bytes) > MAX_IMAGE_BYTES:
        raise ImageProviderError("CUTOUT_UNAVAILABLE")
    try:
        with Image.open(io.BytesIO(image.bytes)) as source:
            prepared = ImageOps.exif_transpose(source).convert("RGB")
            output = io.BytesIO()
            prepared.save(output, format="PNG")
            if output.tell() > MAX_IMAGE_BYTES:
                raise ImageProviderError("CUTOUT_UNAVAILABLE")
            return output.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageProviderError("CUTOUT_UNAVAILABLE") from exc


def _decode_output(payload: object, *, pixel: bool = False) -> bytes:
    try:
        result = payload.get("result", payload) if isinstance(payload, dict) else None
        encoded = result.get("image") if isinstance(result, dict) else None
        if not isinstance(encoded, str):
            raise ValueError("Missing image output")
        image = base64.b64decode(encoded, validate=True)
        if not image or len(image) > MAX_IMAGE_BYTES:
            raise ValueError("Invalid image size")
        with Image.open(io.BytesIO(image)) as decoded:
            if decoded.format not in ("PNG", "JPEG", "WEBP"):
                raise ValueError("Unsupported image output")
            if pixel and (decoded.width != decoded.height or not 256 <= decoded.width <= 2048):
                raise ValueError("Expected square image output")
            decoded.load()
            if decoded.format == "PNG":
                return image
            output = io.BytesIO()
            decoded.convert("RGBA" if "A" in decoded.getbands() else "RGB").save(output, format="PNG")
            converted = output.getvalue()
            if len(converted) > MAX_IMAGE_BYTES:
                raise ValueError("Converted image is too large")
            return converted
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageProviderError("PIXEL_OUTPUT_INVALID" if pixel else "PROVIDER_UNAVAILABLE") from exc


class CloudflareImageProvider:
    def __init__(self, *, account_id: str | None = None, api_token: str | None = None,
                 http: httpx.AsyncClient | None = None) -> None:
        self.account_id = account_id if account_id is not None else os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
        self.api_token = api_token if api_token is not None else os.getenv("CLOUDFLARE_API_TOKEN", "")
        self.http = http

    async def cutout(self, image: GeneratedImage) -> GeneratedImage:
        """Request a separate transparent layer; the original render remains untouched."""
        if not re.fullmatch(r"[0-9a-fA-F]{32}", self.account_id) or not self.api_token.strip():
            raise ImageProviderError("PROVIDER_UNAVAILABLE")
        encoded = base64.b64encode(_cutout_png(image)).decode("ascii")
        owned = self.http is None
        client = self.http or httpx.AsyncClient(timeout=120.0, trust_env=False)
        try:
            response = await client.post(f"{API_ROOT}/{self.account_id}/ai/run",
                headers={"Authorization": f"Bearer {self.api_token}"},
                json={"model": "bria/remove-background", "input": {"image": f"data:image/png;base64,{encoded}"}},
                timeout=120.0)
            if response.status_code == 402:
                raise ImageProviderError("CUTOUT_BILLING_REQUIRED")
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or payload.get("success") is False:
                raise ImageProviderError("CUTOUT_UNAVAILABLE")
            result = payload.get("result", payload)
            if not isinstance(result, dict) or result.get("state", "Completed") != "Completed":
                raise ImageProviderError("CUTOUT_UNAVAILABLE")
            output = result.get("result", result)
            url = output.get("image") if isinstance(output, dict) else None
            parsed = urlparse(url) if isinstance(url, str) else None
            host = (parsed.hostname or "") if parsed else ""
            if not parsed or parsed.scheme != "https" or not (host.endswith(".bria.ai") or host.endswith(".cloudflare.com")):
                raise ImageProviderError("CUTOUT_UNAVAILABLE")
            download = await client.get(url, timeout=120.0)
            download.raise_for_status()
            if len(download.content) > MAX_IMAGE_BYTES:
                raise ImageProviderError("CUTOUT_UNAVAILABLE")
            with Image.open(io.BytesIO(download.content)) as decoded:
                if decoded.format != "PNG" or "A" not in decoded.getbands():
                    raise ImageProviderError("CUTOUT_UNAVAILABLE")
                decoded.verify()
            return GeneratedImage(download.content, "image/png")
        except (httpx.HTTPError, OSError, ValueError) as exc:
            raise ImageProviderError("CUTOUT_UNAVAILABLE") from exc
        finally:
            if owned:
                await client.aclose()

    async def edit(self, portrait: Portrait, recipe: dict, *, task_id: str) -> GeneratedImage:
        if not re.fullmatch(r"[0-9a-fA-F]{32}", self.account_id) or not self.api_token.strip():
            raise ImageProviderError("PROVIDER_UNAVAILABLE")
        references = recipe.get("referenceImages", [])
        if not isinstance(references, list) or len(references) > 2:
            raise ImageProviderError("STYLE_UNAVAILABLE")
        files = [("input_image_0", ("portrait.png", _reference_png(portrait.bytes, portrait.mime), "image/png"))]
        for index, reference in enumerate(references, start=1):
            try:
                data = base64.b64decode(reference["dataBase64"], validate=True)
                image = _reference_png(data, reference["mime"])
            except (KeyError, TypeError, ValueError, ImageProviderError) as exc:
                raise ImageProviderError("STYLE_UNAVAILABLE") from exc
            files.append((f"input_image_{index}", (f"style-{index}.png", image, "image/png")))
        instructions = recipe.get("instructions")
        summary = recipe.get("localSummary", "")
        pixel = recipe.get("id") == "pixel-halfbody-v1"
        if not isinstance(instructions, str) or not instructions or len(instructions) > 30_000:
            raise ImageProviderError("STYLE_UNAVAILABLE")
        prompt = (
            "Image 0 is the user's portrait and the sole identity reference. Preserve facial identity, "
            "expression, head angle, existing accessories and number of people. Follow the style instructions "
            "for cropping, clothing visibility, hair treatment and background. "
            + ("Image 1 is a style reference only; do not copy its person or props. " if pixel
               else "Images 1 and 2 are style references only; do not copy their people or objects. ")
            + "Create one square portfolio hero image "
            "without text, watermark, collage or split screen.\n\n"
            f"Style summary:\n{summary}\n\nFull style instructions:\n{instructions}"
        )
        url = f"{API_ROOT}/{self.account_id}/ai/run/{MODEL}"
        owned = self.http is None
        client = self.http or httpx.AsyncClient(timeout=180.0)
        try:
            response = await client.post(url, headers={"Authorization": f"Bearer {self.api_token}"},
                                         data={"prompt": prompt, "width": "1024", "height": "1024"},
                                         files=files, timeout=180.0)
            if response.status_code == 429:
                raise ImageProviderError("PROVIDER_RATE_LIMIT", True)
            if response.status_code >= 500:
                raise ImageProviderError("PROVIDER_UNAVAILABLE", True)
            if response.status_code in (401, 403):
                raise ImageProviderError("PROVIDER_AUTH")
            if response.status_code >= 400:
                raise ImageProviderError("PROVIDER_REJECTED")
            try:
                payload = response.json()
            except ValueError as exc:
                raise ImageProviderError("PROVIDER_UNAVAILABLE", True) from exc
            if isinstance(payload, dict) and payload.get("success") is False:
                raise ImageProviderError("PROVIDER_UNAVAILABLE", True)
            return GeneratedImage(_decode_output(payload, pixel=pixel))
        except httpx.TimeoutException as exc:
            raise ImageProviderError("PROVIDER_TIMEOUT") from exc
        except httpx.RequestError as exc:
            raise ImageProviderError("PROVIDER_UNAVAILABLE", True) from exc
        finally:
            if owned:
                await client.aclose()
