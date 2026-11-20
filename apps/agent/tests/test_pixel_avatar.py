import io

import pytest
from PIL import Image, ImageDraw

from buildurprofile_agent.providers.base import GeneratedImage, ImageProviderError


def rendered_fixture(background="#f000a8", size=(512, 512), body="#cd8938"):
    image = Image.new("RGB", size, background)
    draw = ImageDraw.Draw(image)
    draw.rectangle((128, 100, 383, 410), fill=body)
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


def gradient_fixture(background="#f000a8"):
    """模拟照片连续调：躯干为 310 级垂直肤色渐变（jld2nd 式平涂像素画应压平为少数色阶）。"""
    image = Image.new("RGB", (512, 512), background)
    draw = ImageDraw.Draw(image)
    top, bottom, rows = (232, 186, 140), (120, 80, 44), 310
    for step in range(rows):
        ratio = step / (rows - 1)
        color = tuple(round(channel + (dark - channel) * ratio) for channel, dark in zip(top, bottom))
        draw.line((128, 100 + step, 383, 100 + step), fill=color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return GeneratedImage(buffer.getvalue())


def test_pixel_avatar_flattens_continuous_tones_to_a_limited_palette():
    # 对标 jld2nd 角色画的 6-10 色平涂：连续调输入须压平到「少数自适应彩色 + 固定中性」，
    # 旧 MEDIANCUT 32 会保留整条渐变（30+ 色），观感是马赛克照片而非像素画。
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    normalized = normalize_pixel_avatar(gradient_fixture())
    with Image.open(io.BytesIO(normalized.bytes)) as image:
        colors = [color for _, color in image.getcolors(256) if color[3] == 255]
        assert len(colors) <= 13  # 8 自适应彩色 + 5 级固定中性（黑到白）
        for y in range(0, 512, 8):
            for x in range(0, 512, 8):
                assert len(image.crop((x, y, x + 8, y + 8)).getcolors(2)) == 1


def test_pixel_avatar_saturates_washed_out_tones():
    # 照片常见灰蒙感（低饱和）须提饱和后再量化：像素画靠色块间对比立形，
    # 低饱和色量化后依然「发灰」。断言躯干中心的饱和度显著高于输入。
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    washed_out = (179, 153, 133)  # 低饱和米色，s≈0.26
    normalized = normalize_pixel_avatar(rendered_fixture(body="#b39985"))
    with Image.open(io.BytesIO(normalized.bytes)) as image:
        center = image.getpixel((256, 256))[:3]
        saturation = (max(center) - min(center)) / max(center)
        assert saturation > (max(washed_out) - min(washed_out)) / max(washed_out) + 0.04


@pytest.mark.parametrize("image", [GeneratedImage(b"corrupt"), rendered_fixture(size=(480, 512)), rendered_fixture(size=(128, 128))])
def test_pixel_avatar_rejects_invalid_output(image):
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    with pytest.raises(ImageProviderError) as error:
        normalize_pixel_avatar(image)
    assert error.value.code == "PIXEL_OUTPUT_INVALID"
    assert not error.value.retryable
