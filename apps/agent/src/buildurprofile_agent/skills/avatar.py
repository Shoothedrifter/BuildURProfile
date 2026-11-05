"""Reviewed Wibi style recipe as a capability-limited image editing Skill."""


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
    image = await tools["image_provider"].edit(portrait, recipe, task_id=task_id)
    await tools["check_cancel"]()
    output_id = await tools["store_output"](image)
    if not await tools["output_exists"](output_id):
        raise ValueError("Image asset failed verification")
    return {"outputAssetId": output_id, "recipeVersion": recipe["version"]}
