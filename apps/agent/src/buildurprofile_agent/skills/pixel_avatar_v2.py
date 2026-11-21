"""Apply a supported photo classification to the approved Pixel World layers."""

from ..contracts import PixelAvatarTraits, PixelAvatarTraitsV2, PixelAvatarTraitsV3
from ..providers.base import ImageProviderError
from .pixel_avatar import STYLE_ID

RECIPE_VERSION = "2.0.0"
DETAILED_RECIPE_VERSION = "3.0.0"
LAYERED_HAIR_RECIPE_VERSION = "4.0.0"


async def generate_layered_pixel_avatar(inputs: dict, tools: dict) -> dict:
    return await _generate(inputs, tools, PixelAvatarTraits, RECIPE_VERSION)


async def generate_detailed_pixel_avatar(inputs: dict, tools: dict) -> dict:
    return await _generate(inputs, tools, PixelAvatarTraitsV2, DETAILED_RECIPE_VERSION)


async def generate_layered_hair_pixel_avatar(inputs: dict, tools: dict) -> dict:
    return await _generate(inputs, tools, PixelAvatarTraitsV3, LAYERED_HAIR_RECIPE_VERSION)


async def _generate(inputs: dict, tools: dict, traits_model: type, recipe_version: str) -> dict:
    await tools["check_cancel"]()
    if inputs["styleId"] != STYLE_ID:
        raise ImageProviderError("STYLE_UNAVAILABLE")

    status = await tools["read_output_status"]()
    if asset_id := status["assetId"]:
        if not status["exists"]:
            raise ImageProviderError("PIXEL_CANDIDATE_EXPIRED")
        return {"outputAssetId": asset_id, "recipeVersion": recipe_version}

    classify = tools["classify_portrait"]
    if classify is None:
        raise ImageProviderError("PROVIDER_UNAVAILABLE")
    portrait = await tools["read_portrait"]()
    await tools["check_cancel"]()
    traits = await classify(portrait)
    await tools["check_cancel"]()
    if type(traits) is not traits_model:
        raise ImageProviderError("PIXEL_TRAITS_INVALID")
    if traits.subject != "usable":
        raise ImageProviderError("PIXEL_PHOTO_UNCLEAR")

    image = await tools["compose_layers"](traits)
    await tools["check_cancel"]()
    output_id = await tools["store_output"](image)
    if not await tools["output_exists"](output_id):
        raise ImageProviderError("PIXEL_OUTPUT_INVALID")
    return {"outputAssetId": output_id, "recipeVersion": recipe_version}
