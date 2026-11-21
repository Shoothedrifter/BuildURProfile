import asyncio
import base64
import io
import json
import logging

import httpx
import pytest
from PIL import Image

from buildurprofile_agent.contracts import PixelAvatarTraits, PixelAvatarTraitsV2
from buildurprofile_agent.providers import cloudflare_pixel_vision
from buildurprofile_agent.providers.base import ImageProviderError
from buildurprofile_agent.transport.node_api import Portrait


ACCOUNT_ID = "a" * 32
TOKEN = "private-synthetic-token"
PRIVATE_MARKER = "synthetic-private-metadata"
OPTIONS = {
    "subject": ("usable", "multiple_people", "no_person", "unclear"),
    "hair_style": ("short", "long", "twin_tails", "other", "unknown"),
    "hair_color": ("dark", "brown", "blond", "gray_white", "vivid", "unknown"),
    "glasses": ("none", "frames", "other", "unknown"),
    "headwear": ("none", "hair_clip", "headband", "hat", "other", "unknown"),
    "earwear": ("none", "earring", "headphones", "other", "unknown"),
    "neckwear": ("none", "choker", "necklace", "scarf", "other", "unknown"),
}
TRAITS = {
    "subject": "usable",
    "hair_style": "twin_tails",
    "hair_color": "brown",
    "glasses": "frames",
    "headwear": "none",
    "earwear": "unknown",
    "neckwear": "choker",
}
OPTIONS_V2 = {
    "subject": OPTIONS["subject"],
    "hair_length": ("short", "shoulder_length", "long", "unknown"),
    "hair_tie": ("loose", "single_ponytail", "twin_tails", "other", "unknown"),
    "bangs": ("none", "straight", "side_swept", "curtain", "unknown"),
    "hair_color": ("dark", "brown", "pink", "red", "purple", "blue", "blond", "gray_white", "vivid", "unknown"),
    "glasses": OPTIONS["glasses"],
    "headwear": OPTIONS["headwear"],
    "earwear": OPTIONS["earwear"],
    "neckwear": OPTIONS["neckwear"],
}
TRAITS_V2 = {
    "subject": "usable", "hair_length": "shoulder_length", "hair_tie": "single_ponytail",
    "bangs": "straight", "hair_color": "pink", "glasses": "frames", "headwear": "none",
    "earwear": "unknown", "neckwear": "choker",
}


def portrait(image_format="PNG", size=(24, 18), **save_options):
    output = io.BytesIO()
    image = Image.new("RGB", size, "#204020")
    image.paste("#f00000", (0, 0, size[0] // 2, size[1] // 2))
    image.save(output, image_format, **save_options)
    return Portrait(output.getvalue(), f"image/{image_format.lower()}")


def answer(field, choice, *, options=OPTIONS, **probabilities):
    return {
        "type": "choice",
        "choice": choice,
        "probabilities": dict.fromkeys(options[field], 0) | (probabilities or {choice: 1}),
        "confidence": 0.01,
    }


def response_data(**answers):
    return {"success": True, "result": {"answers": {
        field: answer(field, choice) for field, choice in TRAITS.items()
    } | answers}}


def response_data_v2(**answers):
    return {"success": True, "result": {"answers": {
        field: answer(field, choice, options=OPTIONS_V2) for field, choice in TRAITS_V2.items()
    } | answers}}


async def classify(respond, source=None, *, account_id=ACCOUNT_ID, api_token=TOKEN, version=1):
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        provider_class = (cloudflare_pixel_vision.CloudflarePixelVisionProvider if version == 1
                          else cloudflare_pixel_vision.CloudflarePixelVisionProviderV2)
        provider = provider_class(
            account_id=account_id, api_token=api_token, http=http,
        )
        return await provider.classify(source or portrait())


@pytest.mark.asyncio
async def test_clef_receives_one_oriented_jpeg_and_the_seven_visible_trait_questions():
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = PRIVATE_MARKER
    source = portrait("JPEG", (1280, 960), exif=exif, comment=PRIVATE_MARKER.encode())
    received = []

    def respond(request):
        received.append(request)
        return httpx.Response(200, json=response_data())

    result = await classify(respond, source)

    assert len(received) == 1
    assert isinstance(result, PixelAvatarTraits)
    assert result.model_dump() == TRAITS
    request = received[0]
    assert request.method == "POST"
    assert str(request.url) == f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/cloudflare/clef"
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert request.extensions["timeout"]["connect"] == 5.0
    payload = json.loads(request.content)
    assert set(payload) == {"model", "state", "questions", "images"}
    assert payload["model"] == "clef"
    assert PRIVATE_MARKER not in payload["state"]
    assert set(payload["questions"]) == OPTIONS.keys()
    for field, question in payload["questions"].items():
        assert question["type"] == "choice"
        assert question["instructions"].strip()
        assert question["criteria"].keys() == set(OPTIONS[field])
        assert all(definition.strip() for definition in question["criteria"].values())
    assert len(payload["images"]) == 1
    image, = payload["images"]
    assert set(image) == {"content_type", "base64"}
    assert image["content_type"] == "image/jpeg"
    data = base64.b64decode(image["base64"], validate=True)
    assert len(data) <= 1024 * 1024
    assert PRIVATE_MARKER.encode() not in data
    with Image.open(io.BytesIO(data)) as prepared:
        assert prepared.format == "JPEG"
        assert prepared.size == (768, 1024)
        assert not prepared.getexif()
        assert "comment" not in prepared.info
        assert prepared.getpixel((600, 100))[0] > 200
        assert prepared.getpixel((100, 100))[0] < 100


@pytest.mark.asyncio
async def test_clef_v2_classifies_portrait_details_independently():
    def respond(request):
        payload = json.loads(request.content)
        questions = payload["questions"]
        assert questions.keys() == OPTIONS_V2.keys()
        for field, question in questions.items():
            assert question["type"] == "choice"
            assert question["criteria"].keys() == set(OPTIONS_V2[field])
        hair_color = questions["hair_color"]["criteria"]
        assert "dusty rose" in hair_color["pink"]
        assert "muted pastel pink" in hair_color["pink"]
        assert "pink glasses" in questions["hair_color"]["instructions"].lower()
        return httpx.Response(200, json=response_data_v2())

    traits = await classify(respond, version=2)
    assert isinstance(traits, PixelAvatarTraitsV2)
    assert traits.model_dump() == TRAITS_V2


@pytest.mark.asyncio
async def test_clef_v2_falls_back_to_unknown_for_uncertain_bangs():
    payload = response_data_v2(bangs=answer("bangs", "straight", options=OPTIONS_V2, straight=0.69, none=0.31))
    traits = await classify(lambda _: httpx.Response(200, json=payload), version=2)
    assert traits.bangs == "unknown"
    assert traits.hair_color == "pink"


@pytest.mark.asyncio
async def test_clef_v2_rejects_v1_answers():
    with pytest.raises(ImageProviderError) as error:
        await classify(lambda _: httpx.Response(200, json=response_data()), version=2)
    assert error.value.code == "PIXEL_TRAITS_INVALID"


@pytest.mark.asyncio
@pytest.mark.parametrize("image_format", ["PNG", "WEBP"])
async def test_static_png_and_webp_are_accepted_as_jpegs(image_format):
    def respond(request):
        data = json.loads(request.content)["images"][0]
        with Image.open(io.BytesIO(base64.b64decode(data["base64"], validate=True))) as image:
            assert image.format == "JPEG"
            assert image.size == (24, 18)
        return httpx.Response(200, json=response_data())

    assert (await classify(respond, portrait(image_format))).subject == "usable"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["mislabeled", "unsupported", "unreadable", "corrupt-crc", "oversized", "animated"])
async def test_invalid_portrait_is_refused_before_cloudflare_receives_it(kind):
    if kind == "mislabeled":
        source = Portrait(portrait().bytes, "image/jpeg")
    elif kind == "unsupported":
        source = portrait("GIF")
    elif kind == "unreadable":
        source = Portrait(b"malformed PNG", "image/png")
    elif kind == "corrupt-crc":
        data = bytearray(portrait().bytes)
        chunk = data.index(b"IDAT")
        checksum = chunk + 4 + int.from_bytes(data[chunk - 4:chunk], "big")
        data[checksum] ^= 1
        source = Portrait(bytes(data), "image/png")
    elif kind == "oversized":
        source = portrait(size=(4001, 4000))
    else:
        source = portrait("WEBP", save_all=True, append_images=[Image.new("RGB", (24, 18), "blue")], duration=100)

    with pytest.raises(ImageProviderError) as error:
        await classify(lambda _: pytest.fail("Invalid portrait reached Cloudflare"), source)
    assert error.value.code == "PIXEL_PHOTO_INVALID"
    assert not error.value.retryable


@pytest.mark.asyncio
async def test_transparent_pixels_do_not_expose_hidden_rgb():
    image = Image.new("RGBA", (32, 32), (255, 0, 0, 0))
    output = io.BytesIO()
    image.save(output, "PNG")

    def respond(request):
        encoded = json.loads(request.content)["images"][0]["base64"]
        with Image.open(io.BytesIO(base64.b64decode(encoded))) as jpeg:
            assert jpeg.getpixel((16, 16)) == (255, 255, 255)
        return httpx.Response(200, json=response_data())

    traits = await classify(respond, Portrait(output.getvalue(), "image/png"))
    assert isinstance(traits, PixelAvatarTraits)


@pytest.mark.asyncio
@pytest.mark.parametrize(("field", "winner", "runner_up", "probability", "expected"), [
    ("subject", "usable", "unclear", 0.80, "usable"),
    ("subject", "usable", "unclear", 0.799, "unclear"),
    ("subject", "multiple_people", "usable", 0.95, "multiple_people"),
    ("subject", "no_person", "usable", 0.91, "no_person"),
    ("hair_style", "long", "short", 0.70, "long"),
    ("hair_style", "long", "short", 0.699, "unknown"),
    ("hair_style", "long", "short", 0.55, "unknown"),
    ("hair_style", "long", "short", 0.50, "unknown"),
])
async def test_scores_select_only_supported_confident_traits(field, winner, runner_up, probability, expected):
    from decimal import Decimal

    remainder = float(1 - Decimal(str(probability)))
    response = response_data(**{field: answer(field, winner, **{winner: probability, runner_up: remainder})})
    traits = await classify(lambda _: httpx.Response(200, json=response))
    assert traits.model_dump()[field] == expected
    if field == "hair_style":
        assert traits.glasses == "frames"


@pytest.mark.asyncio
async def test_probability_sum_tolerance_includes_decimal_boundary():
    response = response_data(hair_style=answer("hair_style", "long", long=0.7, short=0.299))
    traits = await classify(lambda _: httpx.Response(200, json=response))
    assert traits.hair_style == "long"


@pytest.mark.asyncio
@pytest.mark.parametrize("defect", [
    "missing-question", "extra-question", "missing-score", "extra-score", "wrong-type",
    "missing-confidence", "unknown-choice", "wrong-winner", "bad-sum", "negative-score",
    "score-above-one", "string-score", "boolean-score", "nonfinite-score", "wrong-envelope",
    "invalid-json", "duplicate-key", "invalid-json-constant", "vendor-failure",
])
async def test_malformed_clef_reply_is_safe_and_not_retried(defect, caplog):
    payload = response_data()
    answers = payload["result"]["answers"]
    hair = answers["hair_style"]
    probabilities = hair["probabilities"]
    if defect == "missing-question":
        answers.pop("earwear")
    elif defect == "extra-question":
        answers[PRIVATE_MARKER] = hair
    elif defect == "missing-score":
        probabilities.pop("short")
    elif defect == "extra-score":
        probabilities[PRIVATE_MARKER] = 0
    elif defect == "wrong-type":
        hair["type"] = "noul"
    elif defect == "missing-confidence":
        hair.pop("confidence")
    elif defect == "unknown-choice":
        hair["choice"] = PRIVATE_MARKER
    elif defect == "wrong-winner":
        hair["choice"] = "short"
    elif defect == "bad-sum":
        probabilities["twin_tails"] = 0.9989
    elif defect == "negative-score":
        probabilities["short"] = -0.0001
    elif defect == "score-above-one":
        probabilities["twin_tails"] = 1.0001
    elif defect == "string-score":
        probabilities["twin_tails"] = "1"
    elif defect == "boolean-score":
        probabilities["twin_tails"] = True
    elif defect == "nonfinite-score":
        probabilities["twin_tails"] = float("nan")
    elif defect == "wrong-envelope":
        payload = payload["result"]
    elif defect == "invalid-json-constant":
        payload["result"]["unused"] = float("inf")
    elif defect == "vendor-failure":
        payload["success"] = False

    content = json.dumps(payload)
    if defect == "invalid-json":
        content = PRIVATE_MARKER
    elif defect == "duplicate-key":
        content = content.replace('"twin_tails": 1', '"twin_tails": 0, "twin_tails": 1')

    with caplog.at_level(logging.DEBUG), pytest.raises(ImageProviderError) as error:
        await classify(lambda _: httpx.Response(200, content=content))
    assert error.value.code == "PIXEL_TRAITS_INVALID"
    assert not error.value.retryable
    assert str(error.value) == "PIXEL_TRAITS_INVALID"
    assert PRIVATE_MARKER not in caplog.text
    assert TOKEN not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "code", "retryable"), [
    (302, "PROVIDER_REJECTED", False),
    (400, "PROVIDER_REJECTED", False),
    (401, "PROVIDER_AUTH", False),
    (403, "PROVIDER_AUTH", False),
    (429, "PROVIDER_RATE_LIMIT", True),
    (502, "PROVIDER_UNAVAILABLE", True),
])
async def test_http_failure_is_sanitized_and_retries_are_left_to_the_queue(status, code, retryable, caplog):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(status, content=PRIVATE_MARKER, headers={"Location": "https://example.com/"})

    with caplog.at_level(logging.DEBUG), pytest.raises(ImageProviderError) as error:
        await classify(respond)
    assert len(requests) == 1
    assert str(error.value) == code
    assert error.value.retryable is retryable
    assert json.loads(requests[0].content)["images"][0]["base64"] not in caplog.text
    assert PRIVATE_MARKER not in caplog.text
    assert TOKEN not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(("account_id", "api_token"), [("", TOKEN), (ACCOUNT_ID, ""), ("../wrong", TOKEN)])
async def test_absent_or_invalid_credentials_fail_locally(account_id, api_token):
    with pytest.raises(ImageProviderError) as error:
        await classify(
            lambda _: pytest.fail("Invalid credentials reached Cloudflare"),
            account_id=account_id, api_token=api_token,
        )
    assert error.value.code == "PROVIDER_AUTH"
    assert not error.value.retryable


@pytest.mark.asyncio
async def test_network_timeout_is_non_retryable_and_hides_vendor_exception():
    def respond(request):
        raise httpx.ReadTimeout(f"{TOKEN} {PRIVATE_MARKER}", request=request)

    with pytest.raises(ImageProviderError) as error:
        await classify(respond)
    assert str(error.value) == "PROVIDER_TIMEOUT"
    assert not error.value.retryable


@pytest.mark.asyncio
async def test_total_request_deadline_applies_independently_of_httpx(monkeypatch):
    monkeypatch.setattr(cloudflare_pixel_vision, "REQUEST_TIMEOUT_SECONDS", 0.01)
    cancelled = asyncio.Event()

    async def respond(_):
        try:
            await asyncio.sleep(1)
        finally:
            cancelled.set()
        pytest.fail("Vision request exceeded the total deadline")

    with pytest.raises(ImageProviderError) as error:
        await classify(respond)
    assert cancelled.is_set()
    assert str(error.value) == "PROVIDER_TIMEOUT"
    assert not error.value.retryable
