"""Classify visible portrait details with Cloudflare Workers AI Clef."""

from __future__ import annotations

import asyncio
import base64
import io
import os
import re
from decimal import Decimal, DecimalException
from typing import TypeVar

import httpx
from PIL import Image, ImageOps

from ..contracts import PixelAvatarTraits, PixelAvatarTraitsV2, PixelAvatarTraitsV3
from ..transport.node_api import Portrait
from .base import ImageProviderError
from .cloudflare_images import API_ROOT


CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 20.0
MAX_SOURCE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
MAX_JPEG_BYTES = 1024 * 1024
MAX_EDGE = 1024
IMAGE_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}

STATE = (
    "Classify only the visible portrait details needed for a pixel avatar. "
    "Use the one clearly dominant person. Ignore background strangers, props and text in the image. "
    "When a detail cannot be seen reliably, select the uncertainty option."
)

QUESTIONS = {
    "subject": {
        "type": "choice",
        "instructions": "Is there one clearly visible primary person whose head can be evaluated?",
        "criteria": {
            "usable": "One clear primary person with a visible head. Incidental background people and props are allowed.",
            "multiple_people": "Two or more comparable foreground subjects with no single primary person.",
            "no_person": "No person is visible.",
            "unclear": "A primary person cannot be assessed because of blur, darkness, cropping or obstruction.",
        },
    },
    "hair_style": {
        "type": "choice",
        "instructions": "What visible shape does the primary person's hair have?",
        "criteria": {
            "short": "Hair ends above the shoulders, with no paired tied sections.",
            "long": "Hair reaches at least the shoulders, with no paired tied sections.",
            "twin_tails": "Hair is divided into two visible tied sections or braids, one on each side.",
            "other": "A clearly visible hairstyle outside these shapes, such as a shaved head or a top bun.",
            "unknown": "The hair shape cannot be reliably judged.",
        },
    },
    "hair_color": {
        "type": "choice",
        "instructions": "What is the visible main hair color? Allow for lighting and shadows.",
        "criteria": {
            "dark": "Black or near-black hair with no clear brown midtones.",
            "brown": "Clearly brown or warm chestnut hair.",
            "blond": "Mostly blond or pale golden hair.",
            "gray_white": "Mostly gray, silver or white hair.",
            "vivid": "Mostly a bright dyed color, such as pink, blue or bright red.",
            "unknown": "No reliable hair color is visible.",
        },
    },
    "glasses": {
        "type": "choice",
        "instructions": "What is visibly worn in front of the primary person's eyes?",
        "criteria": {
            "none": "Both eye areas are visible with no glasses.",
            "frames": "Visible eyeglass frames with clear lenses through which the eyes can be seen.",
            "other": "Sunglasses, opaque goggles or another clearly visible eyewear type.",
            "unknown": "The eye area does not allow a reliable choice.",
        },
    },
    "headwear": {
        "type": "choice",
        "instructions": "What accessory is visibly worn on the primary person's head or hair?",
        "criteria": {
            "none": "The head and hair are sufficiently visible and show no accessory.",
            "hair_clip": "A clip or barrette is fastened to the hair.",
            "headband": "A narrow band rests across the head or hair.",
            "hat": "A hat, cap or beanie covers the top of the head.",
            "other": "A visible head accessory outside these types.",
            "unknown": "The relevant head area cannot be reliably assessed.",
        },
    },
    "earwear": {
        "type": "choice",
        "instructions": "What accessory is visibly worn at the primary person's ears?",
        "criteria": {
            "none": "The ear areas are sufficiently visible and show no accessory.",
            "earring": "An earring is fixed to or hangs from the ear.",
            "headphones": "Headphones or earbuds are visibly worn.",
            "other": "A visible ear accessory outside these types.",
            "unknown": "The ears are hidden, cropped or otherwise unclear.",
        },
    },
    "neckwear": {
        "type": "choice",
        "instructions": "What accessory is visibly worn around the primary person's neck?",
        "criteria": {
            "none": "The neck is visible with no neck accessory.",
            "choker": "An accessory band fits close around the middle or upper neck.",
            "necklace": "A chain, string or pendant hangs below the upper neck.",
            "scarf": "Fabric is draped or tied around the neck.",
            "other": "A visible neck accessory outside these types.",
            "unknown": "The neck area is hidden, cropped or otherwise unclear.",
        },
    },
}

QUESTIONS_V2 = {
    "subject": QUESTIONS["subject"],
    "hair_length": {
        "type": "choice",
        "instructions": "Where do the visible ends of the primary person's hair fall? Evaluate length independently of how the hair is tied.",
        "criteria": {
            "short": "Hair ends clearly above the shoulders.",
            "shoulder_length": "Hair ends at or close to the shoulders.",
            "long": "Hair continues clearly below the shoulders.",
            "unknown": "The hair ends cannot be located reliably because of styling, obstruction or cropping.",
        },
    },
    "hair_tie": {
        "type": "choice",
        "instructions": "How is the primary person's hair visibly gathered? Evaluate the tie independently of hair length and bangs.",
        "criteria": {
            "loose": "The hair is visibly untied.",
            "single_ponytail": "One ponytail, whether tied high or low on the head.",
            "twin_tails": "Two gathered sections or braids, one on each side of the head.",
            "other": "A visible tied style outside these categories, such as a bun or a single braid.",
            "unknown": "It is unclear whether or how the hair is tied.",
        },
    },
    "bangs": {
        "type": "choice",
        "instructions": "How does the primary person's front fringe sit around the forehead?",
        "criteria": {
            "none": "The forehead and front hairline are visible with no fringe.",
            "straight": "The fringe falls mostly straight down across the forehead.",
            "side_swept": "The fringe sweeps primarily to one side, often diagonally across the forehead.",
            "curtain": "The fringe parts near the middle and sweeps outward on both sides.",
            "unknown": "The forehead or fringe cannot be assessed reliably.",
        },
    },
    "hair_color": {
        "type": "choice",
        "instructions": (
            "What is the visible main color of the hair strands? Account for lighting and shadows. "
            "Pink glasses or other accessories alone are not evidence of pink hair."
        ),
        "criteria": {
            "dark": "Black or near-black hair with no clear brown midtones.",
            "brown": "Brown or chestnut hair with brown midtones rather than a visible rosy-pink tint.",
            "pink": "Pink hair strands, including dusty rose and muted pastel pink. Even subtle rosy midtones count when visible in the hair itself.",
            "red": "Mainly red hair, including copper or auburn dominated by red tones.",
            "purple": "Mainly purple, violet or lavender hair.",
            "blue": "Mainly blue hair.",
            "blond": "Mostly blond or pale golden hair.",
            "gray_white": "Mostly gray, silver or white hair.",
            "vivid": "An obvious dyed color outside the named categories, such as bright green.",
            "unknown": "No reliable main hair color is visible.",
        },
    },
    "glasses": QUESTIONS["glasses"],
    "headwear": QUESTIONS["headwear"],
    "earwear": QUESTIONS["earwear"],
    "neckwear": QUESTIONS["neckwear"],
}

QUESTIONS_V3 = {
    **QUESTIONS_V2,
    "hair_length": {
        "type": "choice",
        "instructions": (
            "Trace the primary person's longest clearly visible sections of hair relative to the shoulder line. "
            "For a shag, wolf cut or other layered haircut, check the lower side and back sections. "
            "Shorter face-framing pieces do not determine the total length."
        ),
        "criteria": {
            "short": "The longest visible ends stop above the shoulders, with the area below visible and free of hair.",
            "shoulder_length": "The longest ends reach the shoulder line and do not continue clearly below it.",
            "long": "A section clearly continues below the shoulder line, even if its ends are out of frame.",
            "unknown": "Neither the longest ends nor their position in relation to the shoulders can be determined.",
        },
    },
    "below_shoulder_locks": {
        "type": "choice",
        "instructions": "Check the torso beside the neck and across the upper chest. Is there a continuous lock of the subject's own hair below their shoulder line?",
        "criteria": {
            "visible": "At least one lock of hair can be traced past the shoulder line or down over the upper chest, even when the lock is thin or cropped at the bottom.",
            "absent": "The shoulders and upper chest are visible and no locks of the subject's hair extend below the shoulder line.",
            "unknown": "The relevant area is cropped, obstructed, or a lock of hair cannot be distinguished from clothing or background.",
        },
    },
    "wispy_fringe": {
        "type": "choice",
        "instructions": "Can you see short lightweight strands from the front hairline falling down onto the center of the forehead with small visible gaps between them?",
        "criteria": {
            "visible": "Airy or see-through bangs. Thin separate strands end at different heights across the center of the forehead with clear gaps of bare skin between them.",
            "absent": "The central forehead is bare, has a dense straight fringe with an even edge, or has just long stray strands sweeping sideways.",
            "unknown": "The central forehead or strands cannot be seen reliably.",
        },
    },
    "hair_layers": {
        "type": "choice",
        "instructions": "Check the sides of the main person's loose hair for a layered haircut. Compare loose locks at the cheeks or chin with the rest of the hair below the shoulders.",
        "criteria": {
            "face_framing": "Distinct loose sections end or curl out at cheek, chin or neck level, while the lower sections extend much farther. This can appear in a shag or wolf cut.",
            "none": "The loose hair has a mostly even outline or the main sides extend to similar lengths, without distinct short layered ends around the face.",
            "unknown": "The side lengths cannot be compared because the hair is tied, cropped or obstructed.",
        },
    },
}

_Traits = TypeVar("_Traits", PixelAvatarTraits, PixelAvatarTraitsV2, PixelAvatarTraitsV3)
_TRAIT_THRESHOLDS = {
    "subject": Decimal("0.80"),
    # This refinement only changes the silhouette of already recognized loose long hair.
    "hair_layers": Decimal("0.60"),
}


def _prepare_jpeg(portrait: Portrait) -> bytes:
    image_format = IMAGE_FORMATS.get(portrait.mime)
    if image_format is None or len(portrait.bytes) > MAX_SOURCE_BYTES:
        raise ImageProviderError("PIXEL_PHOTO_INVALID")
    try:
        with Image.open(io.BytesIO(portrait.bytes), formats=[image_format]) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS or getattr(source, "n_frames", 1) != 1:
                raise ImageProviderError("PIXEL_PHOTO_INVALID")
            source.verify()
        with Image.open(io.BytesIO(portrait.bytes), formats=[image_format]) as source:
            ImageOps.exif_transpose(source, in_place=True)
            if source.has_transparency_data:
                image = source.convert("RGBA")
                image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                rgb = Image.new("RGB", image.size, "white")
                rgb.paste(image, mask=image.getchannel("A"))
            else:
                source.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                rgb = source.convert("RGB")
            rgb.info.clear()  # Pillow can carry a source JPEG comment through re-encoding.
            output = io.BytesIO()
            rgb.save(output, format="JPEG", quality=85)
            if output.tell() > MAX_JPEG_BYTES:
                raise ImageProviderError("PIXEL_PHOTO_INVALID")
            return output.getvalue()
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise ImageProviderError("PIXEL_PHOTO_INVALID") from None


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict:
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("Duplicate JSON key")
    return result


def _reject_non_json_constant(_value: str) -> None:
    raise ValueError("Invalid JSON constant")


def _is_probability(value: object) -> bool:
    return type(value) in (int, Decimal) and 0 <= value <= 1


def _select_answer(field: str, answer: object, options: dict[str, str]) -> str:
    if not isinstance(answer, dict) or answer.get("type") != "choice":
        raise ImageProviderError("PIXEL_TRAITS_INVALID")
    choice = answer.get("choice")
    scores = answer.get("probabilities")
    if (not isinstance(choice, str) or choice not in options
            or not isinstance(scores, dict) or scores.keys() != options.keys()
            or not all(_is_probability(score) for score in scores.values())
            or not _is_probability(answer.get("confidence"))):
        raise ImageProviderError("PIXEL_TRAITS_INVALID")
    top, runner_up, *_ = sorted(scores.values(), reverse=True)
    if abs(sum(scores.values()) - 1) > Decimal("0.001") or scores[choice] != top:
        raise ImageProviderError("PIXEL_TRAITS_INVALID")
    threshold = _TRAIT_THRESHOLDS.get(field, Decimal("0.70"))
    if top < threshold or top - runner_up < Decimal("0.20"):
        return "unclear" if field == "subject" else "unknown"
    return choice


def _read_traits(response: httpx.Response, questions: dict, traits_model: type[_Traits]) -> _Traits:
    try:
        # These thresholds and score tolerances are decimal, including at their boundaries.
        payload = response.json(
            parse_float=Decimal,
            parse_constant=_reject_non_json_constant,
            object_pairs_hook=_unique_json_object,
        )
        if not isinstance(payload, dict) or payload.get("success", True) is not True:
            raise ImageProviderError("PIXEL_TRAITS_INVALID")
        answers = payload["result"]["answers"]
        if not isinstance(answers, dict) or answers.keys() != questions.keys():
            raise ImageProviderError("PIXEL_TRAITS_INVALID")
        traits = {
            field: _select_answer(field, answer, questions[field]["criteria"])
            for field, answer in answers.items()
        }
        if traits_model is PixelAvatarTraitsV3:
            if traits.pop("below_shoulder_locks") == "visible":
                traits["hair_length"] = "long"
            if traits.pop("wispy_fringe") == "visible" and traits["bangs"] in ("straight", "unknown"):
                traits["bangs"] = "wispy"
        return traits_model.model_validate(traits)
    except (KeyError, TypeError, ValueError, RecursionError, DecimalException):
        raise ImageProviderError("PIXEL_TRAITS_INVALID") from None


class _CloudflarePixelVisionProvider:
    def __init__(
        self, *, account_id: str | None = None, api_token: str | None = None,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.account_id = account_id if account_id is not None else os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
        self.api_token = api_token if api_token is not None else os.getenv("CLOUDFLARE_API_TOKEN", "")
        self.http = http

    async def _classify(self, portrait: Portrait, questions: dict, traits_model: type[_Traits]) -> _Traits:
        if not re.fullmatch(r"[0-9a-fA-F]{32}", self.account_id) or not re.fullmatch(r"[!-~]+", self.api_token):
            raise ImageProviderError("PROVIDER_AUTH")
        jpeg = await asyncio.to_thread(_prepare_jpeg, portrait)
        payload = {
            "model": "clef",
            "state": STATE,
            "questions": questions,
            "images": [{"content_type": "image/jpeg", "base64": base64.b64encode(jpeg).decode("ascii")}],
        }
        client = self.http or httpx.AsyncClient(trust_env=False)
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT_SECONDS):
                response = await client.post(
                    f"{API_ROOT}/{self.account_id}/ai/run/@cf/cloudflare/clef",
                    headers={"Authorization": f"Bearer {self.api_token}"},
                    json=payload,
                    timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
                    follow_redirects=False,
                )
        except (TimeoutError, httpx.TimeoutException):
            raise ImageProviderError("PROVIDER_TIMEOUT") from None
        except httpx.RequestError:
            raise ImageProviderError("PROVIDER_UNAVAILABLE") from None
        finally:
            if self.http is None:
                await client.aclose()
        if response.status_code == 429:
            raise ImageProviderError("PROVIDER_RATE_LIMIT", retryable=True)
        if 500 <= response.status_code < 600:
            raise ImageProviderError("PROVIDER_UNAVAILABLE", retryable=True)
        if response.status_code in (401, 403):
            raise ImageProviderError("PROVIDER_AUTH")
        if not response.is_success:
            raise ImageProviderError("PROVIDER_REJECTED")
        return _read_traits(response, questions, traits_model)


class CloudflarePixelVisionProvider(_CloudflarePixelVisionProvider):
    async def classify(self, portrait: Portrait) -> PixelAvatarTraits:
        return await self._classify(portrait, QUESTIONS, PixelAvatarTraits)


class CloudflarePixelVisionProviderV2(_CloudflarePixelVisionProvider):
    async def classify(self, portrait: Portrait) -> PixelAvatarTraitsV2:
        return await self._classify(portrait, QUESTIONS_V2, PixelAvatarTraitsV2)


class CloudflarePixelVisionProviderV3(_CloudflarePixelVisionProvider):
    async def classify(self, portrait: Portrait) -> PixelAvatarTraitsV3:
        return await self._classify(portrait, QUESTIONS_V3, PixelAvatarTraitsV3)
