"""Reviewed Wibi style recipe as a capability-limited image editing Skill."""

import io

from PIL import Image, ImageOps

from ..providers.base import GeneratedImage


MAX_DELIVERY_BYTES = 600_000


def compact_generated_image(image: GeneratedImage) -> GeneratedImage:
    """Keep private hero downloads small enough for the public demo tunnel."""
    if len(image.bytes) <= MAX_DELIVERY_BYTES:
        return image
    with Image.open(io.BytesIO(image.bytes)) as source:
        source.load()
        prepared = ImageOps.exif_transpose(source)
        if "A" in prepared.getbands():
            background = Image.new("RGB", prepared.size, "white")
            background.paste(prepared, mask=prepared.getchannel("A"))
            prepared = background
        else:
            prepared = prepared.convert("RGB")
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
    image = compact_generated_image(await tools["image_provider"].edit(portrait, recipe, task_id=task_id))
    await tools["check_cancel"]()
    output_id = await tools["store_output"](image)
    if not await tools["output_exists"](output_id):
        raise ValueError("Image asset failed verification")
    return {"outputAssetId": output_id, "recipeVersion": recipe["version"]}
