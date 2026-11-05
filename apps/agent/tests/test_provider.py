import base64
import io
from types import SimpleNamespace

import pytest
from PIL import Image

from buildurprofile_agent.providers.openai_images import ImageProviderError, OpenAIImageProvider
from buildurprofile_agent.transport.node_api import Portrait


def png():
    stream = io.BytesIO()
    Image.new("RGB", (256, 256)).save(stream, format="PNG")
    return stream.getvalue()


class Images:
    def __init__(self):
        self.kwargs = None

    async def edit(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png()).decode())])


@pytest.mark.asyncio
async def test_image_provider_uses_edit_api_and_opaque_background():
    images = Images()
    provider = OpenAIImageProvider(client=SimpleNamespace(images=images))
    result = await provider.edit(Portrait(png(), "image/png"), {"instructions": "draw in anime style",
        "localSummary": "anime", "referenceImages": []}, task_id="task")
    assert result.mime == "image/png"
    assert result.bytes == png()
    assert images.kwargs["background"] == "opaque"
    assert images.kwargs["image"][0][1] == png()
    assert images.kwargs["model"] == provider.model


@pytest.mark.asyncio
async def test_image_provider_rejects_bad_reference_before_api_call():
    images = Images()
    provider = OpenAIImageProvider(client=SimpleNamespace(images=images))
    with pytest.raises(ImageProviderError) as caught:
        await provider.edit(Portrait(png(), "image/png"), {"instructions": "draw",
            "referenceImages": [{"mime": "image/png", "dataBase64": "bad"}]}, task_id="task")
    assert caught.value.code == "STYLE_UNAVAILABLE"
    assert images.kwargs is None
