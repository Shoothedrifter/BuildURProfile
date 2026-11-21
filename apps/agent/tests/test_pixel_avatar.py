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
        for y in range(0, 512, 16):
            for x in range(0, 512, 16):
                assert len(image.crop((x, y, x + 16, y + 16)).getcolors(2)) == 1


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
        # spill 条宽 16px=新网格 1 格（512÷32）：保证格内不被 BOX 均值与躯干混色
        ImageDraw.Draw(image).rectangle((128, 105, 143, 405), fill="#b41461")
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


def test_pixel_avatar_uses_a_coarse_32_grid():
    # 对标 jld2nd 实测（2026-11）：站点像素画 17~27 格宽、每格 21~34 屏幕像素；
    # 旧 64 格网格在 384/512 舞台上每格只有 6~8px，观感是「细马赛克」而非「大方块」。
    # 网格必须降到 32 格：512 输出中每 16px 块单色，且相邻块存在异色
    # （后者防止整幅单色图让断言假阳性）。
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    normalized = normalize_pixel_avatar(rendered_fixture())
    with Image.open(io.BytesIO(normalized.bytes)) as image:
        blocks = [image.crop((x, y, x + 16, y + 16)).getcolors(2)
                  for y in range(0, 512, 16) for x in range(0, 512, 16)]
        assert all(len(block) == 1 for block in blocks)
        centers = [image.getpixel((x + 8, y + 8)) for y in range(0, 512, 16) for x in range(0, 512, 16)]
        assert len(set(centers)) >= 2


def test_pixel_avatar_flattens_continuous_tones_to_a_limited_palette():
    # 对标 jld2nd 角色画的 6-10 色平涂：连续调输入须压平到固定色板容量之内，
    # 旧 MEDIANCUT 32 会保留整条渐变（30+ 色），观感是马赛克照片而非像素画。
    from buildurprofile_agent.skills.pixel_avatar import normalize_pixel_avatar

    normalized = normalize_pixel_avatar(gradient_fixture())
    with Image.open(io.BytesIO(normalized.bytes)) as image:
        colors = [color for _, color in image.getcolors(256) if color[3] == 255]
        assert len(colors) <= 14  # jld2nd 固定色板共 14 色
        for y in range(0, 512, 16):
            for x in range(0, 512, 16):
                assert len(image.crop((x, y, x + 16, y + 16)).getcolors(2)) == 1


def test_pixel_avatar_maps_to_the_fixed_jld_palette():
    # 严格对标 jld2nd.dev：所有输出色必须来自站点像素画实测的固定色板，
    # 不再有任何自适应彩色——这是「像素画」与「马赛克照片」的分界线。
    from buildurprofile_agent.skills.pixel_avatar import PIXEL_PALETTE, normalize_pixel_avatar

    allowed = {(*color, 255) for color in PIXEL_PALETTE}
    for source in (gradient_fixture(), rendered_fixture(body="#8a5a3a")):
        normalized = normalize_pixel_avatar(source)
        with Image.open(io.BytesIO(normalized.bytes)) as image:
            used = {color for _, color in image.getcolors(4096) if color[3] == 255}
            assert used <= allowed


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
