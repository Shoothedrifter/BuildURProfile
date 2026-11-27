"""Reviewed Wibi style recipe as a capability-limited image editing Skill."""

import io
import logging

from PIL import Image, ImageOps

from ..providers.base import GeneratedImage
from ..providers.base import ImageProviderError


MAX_DELIVERY_BYTES = 600_000
log = logging.getLogger(__name__)


def compact_generated_image(image: GeneratedImage) -> GeneratedImage:
    """Keep private hero downloads small enough for the public demo tunnel."""
    if len(image.bytes) <= MAX_DELIVERY_BYTES:
        return image
    with Image.open(io.BytesIO(image.bytes)) as source:
        source.load()
        prepared = ImageOps.exif_transpose(source)
        prepared = prepared.convert("RGBA" if "A" in prepared.getbands() else "RGB")
        for edge in (1024, 896, 768, 640, 512, 384):
            resized = prepared.copy()
            resized.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            if min(resized.size) < 256:
                continue
            for quality in (86, 78, 70, 62, 54):
                output = io.BytesIO()
                resized.save(output, format="WEBP", quality=quality, method=6)
                if output.tell() <= MAX_DELIVERY_BYTES:
                    return GeneratedImage(output.getvalue(), "image/webp")
    raise ValueError("Generated image cannot be compacted for delivery")


def valid_cutout(image: GeneratedImage) -> bool:
    try:
        with Image.open(io.BytesIO(image.bytes)) as source:
            source.load()
            if "A" not in source.getbands() or min(source.size) < 256:
                return False
            alpha = source.getchannel("A")
            alpha.thumbnail((128, 128))
            width, height = alpha.size
            coverage = sum(value >= 128 for value in alpha.tobytes()) / (width * height)
            # Hats, hair and close crops can legitimately touch either top corner.
            # Require actual removed background along the perimeter instead of a
            # particular composition. A single transparent pixel is insufficient.
            border = [alpha.getpixel((x, y)) for x in range(width) for y in (0, height - 1)]
            border += [alpha.getpixel((x, y)) for y in range(1, height - 1) for x in (0, width - 1)]
            removed_border = sum(value <= 40 for value in border) / len(border)
            return (0.14 <= coverage <= 0.97 and removed_border >= 0.05
                    and alpha.getpixel((width // 2, height // 2)) >= 128)
    except (OSError, ValueError, Image.DecompressionBombError):
        return False


async def generate_avatar(inputs: dict, tools: dict) -> dict:
    task_id, style_id = inputs["taskId"], inputs["styleId"]
    await tools["check_cancel"]()
    recipe = await tools["load_recipe"]()
    if recipe.get("id") != style_id or not recipe.get("version"):
        raise ValueError("Wibi recipe mismatch")
    if recipe.get("license") != "MIT AND LicenseRef-Wibi-Personal-NonCommercial-1.0":
        raise PermissionError("Wibi licence metadata mismatch")
    existing = await tools["existing_output"]()
    if existing and await tools["output_exists"](existing):
        return {"outputAssetId": existing, "recipeVersion": recipe["version"]}
    portrait = await tools["read_portrait"]()
    await tools["check_cancel"]()
    original = await tools["image_provider"].edit(portrait, recipe, task_id=task_id)
    image = compact_generated_image(original)
    await tools["check_cancel"]()
    output_id = await tools["store_output"](image)
    if not await tools["output_exists"](output_id):
        raise ValueError("Image asset failed verification")
    if "store_cutout" in tools and hasattr(tools["image_provider"], "cutout"):
        try:
            cutout = await tools["image_provider"].cutout(original)
            if valid_cutout(cutout):
                await tools["check_cancel"]()
                await tools["store_cutout"](compact_generated_image(cutout))
            else:
                log.warning("avatar cutout skipped id=%s code=CUTOUT_MASK_INVALID", task_id)
        except (ImageProviderError, OSError, ValueError) as error:
            code = error.code if isinstance(error, ImageProviderError) else "CUTOUT_UNAVAILABLE"
            log.warning("avatar cutout skipped id=%s code=%s", task_id, code)
    return {"outputAssetId": output_id, "recipeVersion": recipe["version"]}
