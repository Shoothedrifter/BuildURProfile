"""Compose Pixel World avatars from the fixed, reviewed v2 layers."""

from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache, reduce
from hashlib import sha256
from importlib.resources import files
from importlib.resources.abc import Traversable
import io
import json
from pathlib import Path
from types import MappingProxyType

from PIL import Image, ImageChops

from ..contracts import PixelAvatarTraits
from ..providers.base import GeneratedImage

RECIPE_VERSION = "2.0.0"
_SIZE = (1254, 1254)
_FOREHEAD = (246, 184, 142, 255)
_BROWN = {
    "shadow": (48, 32, 31, 255),
    "mid": (89, 56, 45, 255),
    "light": (138, 92, 67, 255),
}
_REPLACEMENT_STYLES = {"long": "long", "twin_tails": "twin"}
_HAIR_OPERATIONS = ("back", "erase", "restore", "front")
_MANIFEST_SHA256 = "8401c8682ce4eb346b93f1242a4a1b4946c9d4aded82ff05fc96bd4d8c6c8a56"
# These authorization masks are fixed independently of the operation assets
# described by the manifest. Changing one requires a new reviewed pack.
_APPROVED_SHA256 = {
    "hard-lock": "e0ececb2907d0002ad66e6992c7fc1691d22def1a6d58afc3ca9e6f3624f3864",
    "allow-back": "3483ed4c2c4cc3be4f433d9134522def70342c49d6ecc51f547942af98e50ea6",
    "allow-erase": "cbe8e35f556a0e598d12f9d8af3fcdc21bf6ae8646f87b980952c7c7f82178fe",
    "allow-front": "7d5745c9f8eb01ee48ad89355bd19f28932bedaf840610b239fce648d1514d03",
    "allow-glasses": "8b02e028aeb2b5e7349d7f198f14a85b46a7886135332cf93514a9d9797072c1",
    "allow-recolor": "dba3056dc6c36807885899573e5c5c6adc0f3f5442cc59150bc60a009b72ddc8",
    "allow-restore": "232d4c3ced2da488e1a68b5a9b2b24a5d1d9d54cf0190aeca41bf9d539dee356",
}
_REPLACEMENTS = tuple(_REPLACEMENT_STYLES.values())
_RGBA = {"base", "glasses", *(f"{style}-{part}" for style in _REPLACEMENTS for part in ("back", "front"))}
_MASKS = {
    *_APPROVED_SHA256,
    *(f"{style}-{part}" for style in _REPLACEMENTS for part in ("erase", "restore")),
    *(f"{style}-{shade}" for style in ("short", *_REPLACEMENTS) for shade in _BROWN),
}


@dataclass(frozen=True)
class PixelAvatarLayers:
    _pngs: Mapping[str, bytes]

    def _image(self, name: str) -> Image.Image:
        return _decode_png(self._pngs[name], "RGBA" if name in _RGBA else "L")


@dataclass(frozen=True)
class PixelLayerSelection:
    hairstyle: str = "short"
    brown: bool = False
    glasses: bool = False

    @property
    def is_default(self) -> bool:
        return self.hairstyle == "short" and not self.brown and not self.glasses


def _pack_root() -> Traversable:
    return files("buildurprofile_agent").joinpath("resources", "pixel-avatar-v1")


def _read_pinned(pack: Traversable, filename: str, digest: str) -> bytes:
    resource = pack.joinpath(filename)
    if isinstance(resource, Path) and (resource.is_symlink() or not resource.is_file()):
        raise PermissionError("Invalid Pixel World resource path")
    content = resource.read_bytes()
    if sha256(content).hexdigest() != digest:
        raise PermissionError("Invalid Pixel World resource checksum")
    return content


def _decode_png(content: bytes, mode: str) -> Image.Image:
    with Image.open(io.BytesIO(content)) as image:
        if (image.format != "PNG" or image.size != _SIZE or image.mode != mode
                or image.n_frames != 1):
            raise PermissionError("Invalid Pixel World PNG")
        return image.copy()


def _assert_geometry(write: Image.Image, allowed: Image.Image, lock: Image.Image) -> None:
    if ImageChops.subtract(write, allowed).getbbox() or ImageChops.multiply(write, lock).getbbox():
        raise PermissionError("Pixel World operation extends outside its approved area")


def _alpha(image: Image.Image) -> Image.Image:
    return image if image.mode == "L" else image.getchannel("A")


def _validate_geometry(images: dict[str, Image.Image]) -> None:
    lock = images["hard-lock"]
    for name, image in images.items():
        if any(_alpha(image).histogram()[1:255]):
            raise PermissionError("Invalid Pixel World alpha or mask")
        if name.startswith("allow-") and ImageChops.multiply(image, lock).getbbox():
            raise PermissionError("Pixel World approval overlaps the protected area")

    _assert_geometry(_alpha(images["glasses"]), images["allow-glasses"], lock)
    for style in _REPLACEMENTS:
        for operation in _HAIR_OPERATIONS:
            write = _alpha(images[f"{style}-{operation}"])
            _assert_geometry(write, images[f"allow-{operation}"], lock)

    for style in ("short", *_REPLACEMENTS):
        hair = images["allow-erase"]
        if style != "short":
            hair = ImageChops.lighter(_alpha(images[f"{style}-back"]), _alpha(images[f"{style}-front"]))
        covered = Image.new("L", _SIZE)
        for shade in _BROWN:
            mask = images[f"{style}-{shade}"]
            _assert_geometry(mask, images["allow-recolor"], lock)
            if ImageChops.multiply(mask, covered).getbbox():
                raise PermissionError("Pixel World hair shades overlap")
            covered = ImageChops.lighter(covered, mask)
        if ImageChops.difference(hair, covered).getbbox():
            raise PermissionError("Pixel World hair color masks do not match the hairstyle")


@lru_cache(maxsize=1)
def load_pixel_avatar_layers() -> PixelAvatarLayers:
    try:
        pack = _pack_root()
        manifest = json.loads(_read_pinned(pack, "manifest.json", _MANIFEST_SHA256))
        digests = manifest["files"]
        names = _RGBA | _MASKS
        if manifest["version"] != RECIPE_VERSION or digests.keys() != {f"{name}.png" for name in names}:
            raise PermissionError("Invalid Pixel World asset manifest")

        pngs = {}
        for name in names:
            filename = f"{name}.png"
            digest = digests[filename]
            if digest != _APPROVED_SHA256.get(name, digest):
                raise PermissionError("Invalid Pixel World approval checksum")
            pngs[name] = _read_pinned(pack, filename, digest)
        layers = PixelAvatarLayers(MappingProxyType(pngs))
        _validate_geometry({name: layers._image(name) for name in names})
        return layers
    except PermissionError:
        raise
    except (AttributeError, KeyError, OSError, TypeError, ValueError, Image.DecompressionBombError):
        raise PermissionError("Invalid Pixel World asset pack") from None


def select_pixel_layers(traits: PixelAvatarTraits, layers: PixelAvatarLayers) -> PixelLayerSelection:
    if traits.subject != "usable":
        return PixelLayerSelection()
    hairstyle = _REPLACEMENT_STYLES.get(traits.hair_style, "short")
    if f"{hairstyle}-shadow" not in layers._pngs:
        hairstyle = "short"
    return PixelLayerSelection(
        hairstyle=hairstyle,
        brown=traits.hair_color == "brown" and f"{hairstyle}-shadow" in layers._pngs,
        glasses=traits.glasses == "frames" and "glasses" in layers._pngs,
    )


def _assert_output_geometry(
    output: Image.Image, base: Image.Image, allowed: Image.Image, lock: Image.Image,
) -> None:
    # An RGBA getbbox defaults to checking alpha only. Fold across all
    # channels so recoloring under an unchanged alpha still counts as a write.
    difference = reduce(ImageChops.lighter, ImageChops.difference(output, base).split())
    _assert_geometry(difference, allowed, lock)


def compose_pixel_avatar(selection: PixelLayerSelection, layers: PixelAvatarLayers) -> GeneratedImage:
    base = layers._image("base")
    output = base.copy()
    allowed_operations = []
    hairstyle = selection.hairstyle
    if hairstyle != "short":
        output.paste((0, 0, 0, 0), mask=layers._image(f"{hairstyle}-erase"))
        output.paste(_FOREHEAD, mask=layers._image(f"{hairstyle}-restore"))
        repaired_base = output
        output = layers._image(f"{hairstyle}-back")
        output.alpha_composite(repaired_base)
        output.alpha_composite(layers._image(f"{hairstyle}-front"))
        allowed_operations.extend(_HAIR_OPERATIONS)
    if selection.brown:
        for shade, color in _BROWN.items():
            output.paste(color, mask=layers._image(f"{hairstyle}-{shade}"))
        allowed_operations.append("recolor")
    if selection.glasses:
        output.alpha_composite(layers._image("glasses"))
        allowed_operations.append("glasses")

    allowed = reduce(
        ImageChops.lighter,
        (layers._image(f"allow-{operation}") for operation in allowed_operations),
        Image.new("L", _SIZE),
    )
    _assert_output_geometry(output, base, allowed, layers._image("hard-lock"))
    encoded = io.BytesIO()
    output.save(encoded, format="PNG")
    return GeneratedImage(encoded.getvalue())
