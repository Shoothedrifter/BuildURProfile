"""Pinned eye profiles cover the existing layered character without new photo calls."""
from base64 import b64decode
from itertools import product
import json
from pathlib import Path
import struct
import io

from PIL import Image

from buildurprofile_agent.contracts import PixelAvatarTraitsV3
from buildurprofile_agent.skills.pixel_avatar_layers_v2 import render_layered_hair_pixel_avatar


def decode(encoded):
    raw = b64decode(encoded)
    output = bytearray()
    for offset in range(0, len(raw), 6):
        count, *rgba = struct.unpack(">H4B", raw[offset:offset+6])
        output.extend(bytes(rgba)*count)
    return bytes(output)


def test_fixed_eye_profiles_cover_all_current_hair_combinations():
    root = Path(__file__).resolve().parents[3]
    module = (root / "apps/web/src/assets/pixel-gaze-v1/index.ts").read_text()
    assets = json.loads(module.split("export const pixelGazeAssets = ", 1)[1].rsplit(" as const;", 1)[0])
    profiles = {item["id"]: decode(item["original"]) for item in assets["profiles"]}
    for length, tie, bangs, glasses in product(
        ("short", "shoulder_length", "long"),
        ("loose", "single_ponytail", "twin_tails"),
        ("none", "straight", "side_swept", "curtain", "wispy"),
        ("none", "frames"),
    ):
        traits = PixelAvatarTraitsV3(
            subject="usable", hair_length=length, hair_tie=tie, bangs=bangs,
            hair_layers="face_framing", hair_color="blue", glasses=glasses,
            headwear="none", earwear="none", neckwear="none",
        )
        result = render_layered_hair_pixel_avatar(traits)
        assert result is not None
        with Image.open(io.BytesIO(result.bytes)) as image:
            actual = image.crop((441,528,837,608)).tobytes()
        assert actual == profiles["frames" if glasses=="frames" else "plain"], (length,tie,bangs,glasses)


def test_eye_assets_are_reproducible_from_pinned_resources():
    import subprocess
    import sys
    root = Path(__file__).resolve().parents[3]
    subprocess.run([sys.executable, str(root / "scripts/prepare-pixel-gaze-assets.py"), "--check"], cwd=root, check=True)
