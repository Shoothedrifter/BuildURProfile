import base64
import io
from email.parser import BytesParser
from email.policy import default
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image

from buildurprofile_agent.providers import create_image_provider
from buildurprofile_agent.providers.cloudflare_images import CloudflareImageProvider
from buildurprofile_agent.providers.openai_images import ImageProviderError, OpenAIImageProvider
from buildurprofile_agent.transport.node_api import Portrait


def png(size=(1024, 768)):
    output = io.BytesIO()
    Image.new("RGB", size, "purple").save(output, format="PNG")
    return output.getvalue()


def jpeg(size=(256, 256)):
    output = io.BytesIO()
    Image.new("RGB", size, "teal").save(output, format="JPEG")
    return output.getvalue()


def parts(request):
    message = BytesParser(policy=default).parsebytes(
        b"Content-Type: " + request.headers["content-type"].encode() + b"\r\n\r\n" + request.content
    )
    return {part.get_param("name", header="content-disposition"): part for part in message.iter_parts()}


def test_provider_factory_selects_cloudflare_and_keeps_openai_optional():
    assert isinstance(create_image_provider("cloudflare"), CloudflareImageProvider)
    assert isinstance(create_image_provider("openai"), OpenAIImageProvider)
    with pytest.raises(ValueError, match="Unsupported IMAGE_PROVIDER"):
        create_image_provider("unknown")


@pytest.mark.asyncio
async def test_openai_prompt_lets_style_recipe_choose_cropping_and_clothing():
    class FakeImages:
        prompt = ""

        async def edit(self, **kwargs):
            self.prompt = kwargs["prompt"]
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png()).decode())])

    images = FakeImages()
    provider = OpenAIImageProvider(client=SimpleNamespace(images=images))
    await provider.edit(Portrait(png(), "image/png"), {
        "instructions": "remove shoulders and clothing; keep only the head on a yellow backdrop",
        "referenceImages": []
    }, task_id="task")
    assert "remove shoulders and clothing; keep only the head on a yellow backdrop" in images.prompt
    assert "Preserve face, pose, clothing" not in images.prompt


@pytest.mark.asyncio
async def test_cloudflare_sends_portrait_first_and_resizes_style_references():
    captured = []
    result_image = png((1024, 1024))

    def respond(request):
        captured.append(request)
        return httpx.Response(200, json={"success": True, "result": {
            "image": base64.b64encode(result_image).decode()}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        provider = CloudflareImageProvider(account_id="a" * 32, api_token="private-token", http=http)
        image = await provider.edit(Portrait(png(), "image/png"), {
            "instructions": "remove shoulders and clothing; keep only the head on a yellow backdrop", "localSummary": "yellow hair doodle",
            "referenceImages": [{"mime": "image/png", "dataBase64": base64.b64encode(png((800, 800))).decode()}]
        }, task_id="task")

    assert image.bytes == result_image
    assert image.mime == "image/png"
    assert len(captured) == 1
    request = captured[0]
    assert request.url.path == "/client/v4/accounts/" + "a" * 32 + "/ai/run/@cf/black-forest-labs/flux-2-klein-4b"
    assert request.headers["authorization"] == "Bearer private-token"
    fields = parts(request)
    assert set(fields) == {"prompt", "width", "height", "input_image_0", "input_image_1"}
    assert fields["width"].get_content().strip() == "1024"
    assert fields["height"].get_content().strip() == "1024"
    prompt = fields["prompt"].get_content()
    assert "Image 0 is the user's portrait" in prompt
    assert "remove shoulders and clothing; keep only the head on a yellow backdrop" in prompt
    assert "Preserve facial identity, pose, clothing" not in prompt
    for name in ("input_image_0", "input_image_1"):
        with Image.open(io.BytesIO(fields[name].get_payload(decode=True))) as source:
            assert max(source.size) < 512


@pytest.mark.asyncio
async def test_cloudflare_requires_account_and_token_before_request():
    provider = CloudflareImageProvider(account_id="", api_token="")
    with pytest.raises(ImageProviderError) as caught:
        await provider.edit(Portrait(png(), "image/png"), {"instructions": "draw", "referenceImages": []}, task_id="task")
    assert caught.value.code == "PROVIDER_UNAVAILABLE"


@pytest.mark.asyncio
async def test_cloudflare_rate_limit_is_retryable():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(429))) as http:
        provider = CloudflareImageProvider(account_id="a" * 32, api_token="private-token", http=http)
        with pytest.raises(ImageProviderError) as caught:
            await provider.edit(Portrait(png(), "image/png"), {"instructions": "draw", "referenceImages": []}, task_id="task")
    assert caught.value.code == "PROVIDER_RATE_LIMIT"
    assert caught.value.retryable


@pytest.mark.asyncio
async def test_cloudflare_converts_successful_jpeg_response_to_png_asset():
    encoded = base64.b64encode(jpeg()).decode()
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={"success": True, "result": {"image": encoded}}))) as http:
        provider = CloudflareImageProvider(account_id="a" * 32, api_token="private-token", http=http)
        result = await provider.edit(Portrait(png(), "image/png"),
                                     {"instructions": "draw", "referenceImages": []}, task_id="task")
    assert result.mime == "image/png"
    with Image.open(io.BytesIO(result.bytes)) as image:
        assert image.format == "PNG"
        assert image.size == (256, 256)


@pytest.mark.asyncio
async def test_cloudflare_invalid_success_payload_does_not_repeat_billable_call():
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={"success": True, "result": {"image": "not-base64"}}))) as http:
        provider = CloudflareImageProvider(account_id="a" * 32, api_token="private-token", http=http)
        with pytest.raises(ImageProviderError) as caught:
            await provider.edit(Portrait(png(), "image/png"),
                                {"instructions": "draw", "referenceImages": []}, task_id="task")
    assert caught.value.code == "PROVIDER_UNAVAILABLE"
    assert not caught.value.retryable


@pytest.mark.asyncio
async def test_cloudflare_rejects_invalid_credentials_without_suggesting_a_new_photo():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(401))) as http:
        provider = CloudflareImageProvider(account_id="a" * 32, api_token="wrong-token", http=http)
        with pytest.raises(ImageProviderError) as caught:
            await provider.edit(Portrait(png(), "image/png"), {"instructions": "draw", "referenceImages": []}, task_id="task")
    assert caught.value.code == "PROVIDER_AUTH"
    assert not caught.value.retryable
