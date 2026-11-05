"""External image editing adapter. No model weights or source photos are persisted here."""

from __future__ import annotations

import base64
import io
import os
from dataclasses import dataclass

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from PIL import Image

from ..transport.node_api import Portrait


@dataclass(frozen=True)
class GeneratedImage:
    bytes: bytes
    mime: str = "image/png"


class ImageProviderError(RuntimeError):
    def __init__(self, code: str, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def _image_file(data: bytes, mime: str, name: str) -> tuple[str, bytes, str]:
    if mime not in ("image/png", "image/jpeg", "image/webp") or len(data) > 10 * 1024 * 1024:
        raise ImageProviderError("PROVIDER_REJECTED")
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
    except Exception as exc:
        raise ImageProviderError("PROVIDER_REJECTED") from exc
    return (name, data, mime)


def _extension(mime: str) -> str:
    return {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(mime, "bin")


class OpenAIImageProvider:
    def __init__(self, *, api_key: str | None = None, model: str | None = None,
                 client: AsyncOpenAI | None = None) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("OPENAI_API_KEY", "")
        self.model = model or os.getenv("OPENAI_IMAGE_MODEL") or "gpt-image-2.5-sunburst-2026-09-08"
        self.client = client

    async def edit(self, portrait: Portrait, recipe: dict, *, task_id: str) -> GeneratedImage:
        if not self.client and not self.api_key:
            raise ImageProviderError("PROVIDER_UNAVAILABLE")
        references = recipe.get("referenceImages", [])
        if not isinstance(references, list) or len(references) > 2:
            raise ImageProviderError("STYLE_UNAVAILABLE")
        files = [_image_file(portrait.bytes, portrait.mime, "portrait." + _extension(portrait.mime))]
        for index, reference in enumerate(references):
            try:
                data = base64.b64decode(reference["dataBase64"], validate=True)
                files.append(_image_file(data, reference["mime"],
                                         f"style-{index}.{_extension(reference['mime'])}"))
            except ImageProviderError as exc:
                raise ImageProviderError("STYLE_UNAVAILABLE") from exc
            except (KeyError, TypeError, ValueError) as exc:
                raise ImageProviderError("STYLE_UNAVAILABLE") from exc
        instructions = recipe.get("instructions", "")
        summary = recipe.get("localSummary", "")
        if not isinstance(instructions, str) or not instructions or len(instructions) > 30_000:
            raise ImageProviderError("STYLE_UNAVAILABLE")
        prompt = (
            "Image 1 is the user's portrait and the sole identity reference. Preserve face, pose, "
            "clothing, accessories and number of people. Other images are style references only; "
            "do not copy their people or objects. Create one square animated portfolio hero portrait "
            "with the original style background, no text, watermark, collage or split screen.\n\n"
            f"Style summary:\n{summary}\n\nFull style instructions:\n{instructions}"
        )
        client = self.client or AsyncOpenAI(api_key=self.api_key, max_retries=0)
        try:
            response = await client.images.edit(model=self.model, image=files, prompt=prompt,
                                                size="1024x1024", quality="high", output_format="png",
                                                background="opaque", input_fidelity="high", n=1,
                                                timeout=180.0)
        except APIStatusError as exc:
            if exc.status_code == 429:
                raise ImageProviderError("PROVIDER_RATE_LIMIT", True) from exc
            if exc.status_code >= 500:
                raise ImageProviderError("PROVIDER_UNAVAILABLE", True) from exc
            raise ImageProviderError("PROVIDER_REJECTED") from exc
        except APITimeoutError as exc:
            raise ImageProviderError("PROVIDER_TIMEOUT") from exc
        except APIConnectionError as exc:
            raise ImageProviderError("PROVIDER_UNAVAILABLE", True) from exc
        finally:
            if self.client is None:
                await client.close()
        encoded = response.data[0].b64_json if response.data else None
        if not encoded:
            raise ImageProviderError("PROVIDER_UNAVAILABLE", True)
        try:
            image = base64.b64decode(encoded, validate=True)
            _image_file(image, "image/png", "output.png")
        except (ValueError, TypeError) as exc:
            raise ImageProviderError("PROVIDER_UNAVAILABLE", True) from exc
        return GeneratedImage(image)
