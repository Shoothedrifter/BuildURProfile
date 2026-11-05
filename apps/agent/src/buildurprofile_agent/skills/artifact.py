"""Validate the final renderer contract and portrait asset reference."""

from ..contracts import clean_config


async def verify_artifact(inputs: dict, tools: dict) -> dict:
    clean_config(inputs["config"])
    if inputs.get("portraitAssetId"):
        output_id = inputs.get("outputAssetId")
        if not output_id or not await tools["output_exists"](output_id):
            raise ValueError("Portrait asset missing")
    elif inputs.get("outputAssetId") or inputs.get("styleId"):
        raise ValueError("Unexpected portrait on text-only task")
    return {"ok": True}
