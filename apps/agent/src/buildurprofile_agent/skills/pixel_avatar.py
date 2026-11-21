"""Generate a preview-only pixel bust from an approved portrait and a fixed recipe."""

from collections import deque
from colorsys import rgb_to_hsv
import io

from PIL import Image, ImageEnhance

from ..providers.base import GeneratedImage, ImageProviderError

STYLE_ID = "pixel-halfbody-v1"
RECIPE_VERSION = "1.1.0"
RECIPE_LICENSE = "LicenseRef-BuildURProfile-Original-Preview-1.0"
SOURCE_BYTES_LIMIT = 10 * 1024 * 1024
MASTER_EDGE = 32  # 对标 jld2nd 粗网格（17~27 格宽）：512 输出中每格 16px，方块感立形
OUTPUT_EDGE = 512
MATTE = (240, 0, 168)
NEIGHBORS = ((-1, 0), (1, 0), (0, -1), (0, 1))
# jld2nd.dev 固定色板（2026-11 实测自站点像素画 SVG fill 全集）：
# 全套无灰阶——暗部用深棕红、亮部用白，颜色纪律是「像素画」的核心；
# 照片头像提饱和后做最近邻映射，肤色落到 pink/cream/orange/dark-maroon 档。
PIXEL_PALETTE = (
    (0, 0, 0),         # black（轮廓/暗部）
    (255, 255, 255),   # white（高光/留白）
    (206, 255, 0),     # lime（主强调）
    (247, 206, 0),     # yellow
    (247, 118, 63),    # orange
    (238, 59, 62),     # red
    (105, 29, 26),     # dark-maroon（阴影/深肤色）
    (246, 205, 219),   # pink（浅肤色）
    (238, 231, 213),   # cream（米白肤色）
    (0, 141, 227),     # blue
    (7, 150, 237),     # sky
    (140, 101, 255),   # purple
    (15, 171, 147),    # teal
    (0, 255, 195),     # mint
)
SATURATION_BOOST = 1.35


def _quantize_flat(image: Image.Image) -> Image.Image:
    boosted = ImageEnhance.Color(image).enhance(SATURATION_BOOST)
    swatch = Image.new("P", (1, 1))
    swatch.putpalette([channel for color in PIXEL_PALETTE for channel in color])
    return boosted.quantize(palette=swatch, dither=Image.Dither.NONE)


def _is_magenta(color: tuple[int, int, int]) -> bool:
    hue, saturation, brightness = rgb_to_hsv(*(channel / 255 for channel in color))
    return 295 <= hue * 360 <= 352 and saturation >= 0.48 and brightness >= 0.4


def _matte_color(image: Image.Image) -> tuple[int, int, int]:
    edge = MASTER_EDGE - 1
    corners = [image.getpixel(point) for point in ((0, 0), (0, edge), (edge, 0), (edge, edge))]
    for color in corners:
        if not _is_magenta(color):
            continue
        matching = [corner for corner in corners if max(abs(a - b) for a, b in zip(corner, color)) <= 16]
        if len(matching) >= 3:
            return tuple(round(sum(channels) / len(matching)) for channels in zip(*matching))
    return MATTE


def _background_mask(image: Image.Image) -> Image.Image | None:
    size = MASTER_EDGE
    pixels = image.load()
    color = _matte_color(image)
    matte = bytearray(size * size)
    edges = deque((x, y) for y in range(size) for x in range(size)
                  if x in (0, size - 1) or y in (0, size - 1))
    while edges:
        x, y = edges.popleft()
        if not (0 <= x < size and 0 <= y < size):
            continue
        index = y * size + x
        if matte[index] or any(abs(channel - expected) > 24 for channel, expected in zip(pixels[x, y], color)):
            continue
        matte[index] = 1
        edges.extend((x + dx, y + dy) for dx, dy in NEIGHBORS)
    coverage = 1 - sum(matte) / len(matte)
    if not 0.14 <= coverage <= 0.88 or matte[(size // 2) * size + size // 2]:
        return None
    return Image.frombytes("L", (size, size), bytes(0 if background else 255 for background in matte))


def _remove_matte_spill(image: Image.Image, alpha: Image.Image) -> Image.Image:
    pixels, mask = image.load(), alpha.load()
    corrected = image.copy()
    for y in range(MASTER_EDGE):
        for x in range(MASTER_EDGE):
            if not mask[x, y] or not _is_magenta(pixels[x, y]):
                continue
            adjacent = [(x + dx, y + dy) for dx, dy in NEIGHBORS
                        if 0 <= x + dx < MASTER_EDGE and 0 <= y + dy < MASTER_EDGE]
            if not any(not mask[point] for point in adjacent):
                continue
            foreground = [pixels[point] for point in adjacent if mask[point] and not _is_magenta(pixels[point])]
            if foreground:
                corrected.putpixel((x, y), foreground[0])
    return corrected


def normalize_pixel_avatar(image: GeneratedImage) -> GeneratedImage:
    try:
        if len(image.bytes) > SOURCE_BYTES_LIMIT:
            raise ValueError("Image exceeds size limit")
        with Image.open(io.BytesIO(image.bytes)) as source:
            width, height = source.size
            if source.format not in ("PNG", "JPEG", "WEBP") or width != height or not 256 <= width <= 2048:
                raise ValueError("Expected a supported square image")
            master = source.convert("RGB").resize((MASTER_EDGE, MASTER_EDGE), Image.Resampling.BOX)
        alpha = _background_mask(master)
        if alpha is not None:
            master = _remove_matte_spill(master, alpha)
        image = _quantize_flat(master).convert("RGB")
        if alpha is not None:
            image.putalpha(alpha)
        encoded = io.BytesIO()
        image.resize((OUTPUT_EDGE, OUTPUT_EDGE), Image.Resampling.NEAREST).save(encoded, format="PNG", optimize=True)
        return GeneratedImage(encoded.getvalue())
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise ImageProviderError("PIXEL_OUTPUT_INVALID") from error


async def generate_pixel_avatar(inputs: dict, tools: dict) -> dict:
    await tools["check_cancel"]()
    recipe = await tools["load_recipe"]()
    if (inputs["styleId"] != STYLE_ID or recipe.get("id") != STYLE_ID
            or recipe.get("version") != RECIPE_VERSION or recipe.get("license") != RECIPE_LICENSE
            or not isinstance(recipe.get("referenceImages"), list) or len(recipe["referenceImages"]) != 1):
        raise ImageProviderError("STYLE_UNAVAILABLE")
    existing = await tools["existing_output"]()
    if existing and await tools["output_exists"](existing):
        return {"outputAssetId": existing, "recipeVersion": RECIPE_VERSION}
    if tools["image_provider"] is None:
        raise ImageProviderError("PROVIDER_UNAVAILABLE")
    portrait = await tools["read_portrait"]()
    await tools["check_cancel"]()
    original = await tools["image_provider"].edit(portrait, recipe, task_id=inputs["taskId"])
    image = normalize_pixel_avatar(original)
    await tools["check_cancel"]()
    output_id = await tools["store_output"](image)
    if not await tools["output_exists"](output_id):
        raise ImageProviderError("PIXEL_OUTPUT_INVALID")
    return {"outputAssetId": output_id, "recipeVersion": RECIPE_VERSION}
