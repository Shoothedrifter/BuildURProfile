import io

import pytest
from PIL import Image, ImageDraw

from buildurprofile_agent.providers.base import GeneratedImage, ImageProviderError


def rendered_fixture(background="#f000a8", size=(512, 512)):
    image = Image.new("RGB", size, background)
    draw = ImageDraw.Draw(image)
    draw.rectangle((128, 100, 383, 410), fill="#cd8938")
    draw.rectangle((200, 160, 215, 175), fill="#f000a8")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return GeneratedImage(buffer.getvalue())


def test_pixel_avatar_quantizes_and_upscales_without_blurring():
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    original = rendered_fixture()
    normalized = normalize_pixel_avatar(original)
    assert normalized.bytes == normalize_pixel_avatar(original).bytes
    with Image.open(io.BytesIO(normalized.bytes)) as image:
        assert (image.format, image.size, image.mode) == ("PNG", (512, 512), "RGBA")
        assert image.getpixel((0, 0))[3] == 0
        assert image.getpixel((204, 165))[3] == 255
        assert set(image.getchannel("A").tobytes()) == {0, 255}
        assert len([color for _, color in image.getcolors(64) if color[3] == 255]) <= 32
        for y in range(0, 512, 8):
            for x in range(0, 512, 8):
                assert len(image.crop((x, y, x + 8, y + 8)).getcolors(2)) == 1


def test_pixel_avatar_keeps_a_card_without_a_reliable_background():
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    normalized = normalize_pixel_avatar(rendered_fixture("#283344"))
    with Image.open(io.BytesIO(normalized.bytes)) as image:
        assert image.convert("RGBA").getchannel("A").getextrema() == (255, 255)


@pytest.mark.parametrize("background", ["#d31d70", "#c91873", "#ab315f"])
def test_pixel_avatar_removes_a_uniform_magenta_background_shift(background):
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    normalized = normalize_pixel_avatar(rendered_fixture(background))
    with Image.open(io.BytesIO(normalized.bytes)) as image:
        assert image.mode == "RGBA"
        assert image.getpixel((0, 0))[3] == 0
        assert image.getpixel((256, 256))[3] == 255


def test_pixel_avatar_replaces_matte_spill_only_on_the_outer_edge():
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    with Image.open(io.BytesIO(rendered_fixture().bytes)) as image:
        ImageDraw.Draw(image).rectangle((128, 105, 135, 405), fill="#b41461")
        source = io.BytesIO()
        image.save(source, format="PNG")
    with Image.open(io.BytesIO(normalize_pixel_avatar(GeneratedImage(source.getvalue())).bytes)) as result:
        assert result.getpixel((128, 256)) == result.getpixel((136, 256))
        assert result.getpixel((128, 256))[3] == 255
        assert result.getpixel((204, 165)) != result.getpixel((136, 256))


@pytest.mark.parametrize("image", [GeneratedImage(b"corrupt"), rendered_fixture(size=(480, 512)), rendered_fixture(size=(128, 128))])
def test_pixel_avatar_rejects_invalid_output(image):
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    with pytest.raises(ImageProviderError) as error:
        normalize_pixel_avatar(image)
    assert error.value.code == "PIXEL_OUTPUT_INVALID"
    assert not error.value.retryable
