"""Render detailed Pixel World traits with reviewed, local pixel art."""

from functools import lru_cache
from importlib.resources import files
import io
import json

from PIL import Image, ImageChops, ImageDraw

from ..contracts import PixelAvatarTraitsV2, PixelAvatarTraitsV3
from ..providers.base import GeneratedImage
from .pixel_avatar_layers import (
    PixelAvatarLayers,
    _assert_output_geometry,
    _FOREHEAD,
    _read_pinned,
    _SIZE,
    load_pixel_avatar_layers,
)


_ARTWORK_SHA256 = "95403499c2f01a7ffa11d8f209c78604b37aaf24549ea60bf788ba6d537924b4"
_LAYERED_ARTWORK_SHA256 = "9ba90dab420d63e30828d3b31396d8341df02000c8d91e36ebafd286cef4a336"
_CELL = 18
_GRID = (70, 70)
_SHADES = ("shadow", "mid", "light")
_DARK = ("#30222b", "#46323e", "#5b414f")
_PALETTES = {
    "brown": ("#30201f", "#59382d", "#8a5c43"),
    "pink": ("#895467", "#b7788a", "#d59eab"),
    "red": ("#6b2c37", "#9c4448", "#c26659"),
    "purple": ("#4c305d", "#74508c", "#a078b5"),
    "blue": ("#293c66", "#46639a", "#7093bf"),
    "blond": ("#86643d", "#bd925b", "#e8c589"),
    "gray_white": ("#706777", "#a29aaa", "#d9d0d9"),
}
_FRINGES = ("straight", "side_swept", "curtain")
_CUT_MASKS = ("shoulder-cut", "twin-short-cut", "pony-short-cut", "pony-shoulder-cut")
_PONY_CUT = {"short": "pony-short-cut", "shoulder_length": "pony-shoulder-cut"}


def _mask(polygons: list) -> Image.Image:
    artwork = Image.new("L", _GRID)
    draw = ImageDraw.Draw(artwork)
    for polygon in polygons:
        draw.polygon([tuple(point) for point in polygon], fill=255)
    width, height = _GRID
    return artwork.resize((width * _CELL, height * _CELL), Image.Resampling.NEAREST).crop(
        (0, 0, *_SIZE),
    )


@lru_cache(maxsize=1)
def _artwork() -> dict[str, tuple[Image.Image, ...]]:
    pack = files("buildurprofile_agent").joinpath("resources", "pixel-avatar-v2")
    try:
        shapes = json.loads(_read_pinned(pack, "artwork.json", _ARTWORK_SHA256))
        assets = {name: (_mask(shapes[name]),) for name in ("forehead", *_CUT_MASKS)}
        for name in ("ponytail", "short-twins", *_FRINGES):
            assets[name] = tuple(_mask(polygons) for polygons in shapes[name])
        return assets
    except PermissionError:
        raise
    except (KeyError, OSError, TypeError, ValueError):
        raise PermissionError("Invalid detailed Pixel World artwork") from None


@lru_cache(maxsize=1)
def _layered_artwork() -> dict[str, tuple[Image.Image, ...]]:
    pack = files("buildurprofile_agent").joinpath("resources", "pixel-avatar-v3")
    try:
        shapes = json.loads(_read_pinned(pack, "artwork.json", _LAYERED_ARTWORK_SHA256))
        return {
            "long-top": (_mask(shapes["long-top"]),),
            "loose-long": tuple(_mask(polygons) for polygons in shapes["loose-long"]),
            "wispy": tuple(_mask(polygons) for polygons in shapes["wispy"]),
        }
    except PermissionError:
        raise
    except (KeyError, OSError, TypeError, ValueError):
        raise PermissionError("Invalid layered Pixel World artwork") from None


def _paint_layer(
    output: Image.Image,
    artwork: tuple[Image.Image, ...],
    palette: tuple[str, ...],
    allowed: Image.Image,
) -> None:
    for shade, color in zip(artwork, palette, strict=True):
        output.paste(color, mask=ImageChops.multiply(shade, allowed))


def _base_with_hair(
    layers: PixelAvatarLayers, base: Image.Image, style: str, cut: Image.Image | None,
    palette: tuple[str, ...] | None,
) -> Image.Image:
    output = base.copy()
    if style != "short":
        output.paste((0, 0, 0, 0), mask=layers._image(f"{style}-erase"))
        output.paste(_FOREHEAD, mask=layers._image(f"{style}-restore"))
        for part in ("back", "front"):
            layer = layers._image(f"{style}-{part}")
            if cut is not None:
                layer.putalpha(ImageChops.multiply(layer.getchannel("A"), cut))
            output.paste(layer, mask=layer.getchannel("A"))
    if palette is not None:
        for shade, color in zip(_SHADES, palette, strict=True):
            tint = layers._image(f"{style}-{shade}")
            if cut is not None:
                tint = ImageChops.multiply(tint, cut)
            output.paste(color, mask=tint)
    return output


def render_detailed_pixel_avatar(traits: PixelAvatarTraitsV2) -> GeneratedImage | None:
    return _render_pixel_avatar(traits)


def render_layered_hair_pixel_avatar(traits: PixelAvatarTraitsV3) -> GeneratedImage | None:
    loose_long = (
        traits.hair_length == "long"
        and traits.hair_tie in ("loose", "unknown")
        and traits.hair_layers == "face_framing"
    )
    return _render_pixel_avatar(traits, loose_long=loose_long, wispy=traits.bangs == "wispy")


def _render_pixel_avatar(
    traits: PixelAvatarTraitsV2, *, loose_long: bool = False, wispy: bool = False,
) -> GeneratedImage | None:
    if traits.subject != "usable":
        return None

    ponytail = traits.hair_tie == "single_ponytail"
    twin_tails = traits.hair_tie == "twin_tails"
    short_twins = twin_tails and traits.hair_length == "short"
    shoulder = traits.hair_length == "shoulder_length"
    cut_name = None
    if twin_tails:
        style = "twin"
        if shoulder:
            cut_name = "shoulder-cut"
        elif short_twins:
            cut_name = "twin-short-cut"
    elif ponytail:
        style = "short"
        cut_name = _PONY_CUT.get(traits.hair_length)
    elif shoulder or traits.hair_length == "long":
        style = "long"
        if shoulder:
            cut_name = "shoulder-cut"
    else:
        style = "short"
    palette = _PALETTES.get(traits.hair_color)
    fringe = traits.bangs != "unknown"
    glasses = traits.glasses == "frames"
    if style == "short" and not (ponytail or fringe or palette or glasses):
        return None

    layers = load_pixel_avatar_layers()
    base = layers._image("base")
    allowed = Image.new("L", _SIZE)
    artwork = _artwork() if ponytail or fringe or cut_name else {}
    layered_artwork = _layered_artwork() if loose_long or wispy else {}
    cut = artwork[cut_name][0] if cut_name else None
    if loose_long:
        cut = layered_artwork["long-top"][0]
    output = _base_with_hair(layers, base, style, cut if not ponytail else None, palette)

    if style != "short" or ponytail or fringe or palette is not None:
        allowed = layers._image("allow-recolor")
    if loose_long:
        _paint_layer(output, layered_artwork["loose-long"], palette or _DARK, allowed)
    if ponytail:
        back = layers._image("allow-back")
        if cut is not None:
            back = ImageChops.multiply(back, cut)
        _paint_layer(output, artwork["ponytail"], palette or _DARK, back)
    if short_twins:
        _paint_layer(output, artwork["short-twins"], palette or _DARK, layers._image("allow-back"))
    if fringe:
        # Put back the base skin inside the hairline, including areas covered by
        # the old long/twin fringe. Where the base itself had bangs, use the
        # pinned forehead mask before applying the selected new fringe.
        forehead = ImageChops.multiply(artwork["forehead"][0], layers._image("allow-front"))
        output.paste(base, mask=forehead)
        output.paste(_FOREHEAD, mask=ImageChops.multiply(forehead, layers._image("allow-restore")))
        if wispy:
            _paint_layer(output, layered_artwork["wispy"], palette or _DARK, allowed)
        elif traits.bangs in _FRINGES:
            _paint_layer(output, artwork[traits.bangs], palette or _DARK, allowed)
    if glasses:
        output.alpha_composite(layers._image("glasses"))
        allowed = ImageChops.lighter(allowed, layers._image("allow-glasses"))

    _assert_output_geometry(output, base, allowed, layers._image("hard-lock"))
    if output.tobytes() == base.tobytes():
        return None

    encoded = io.BytesIO()
    output.save(encoded, format="PNG")
    return GeneratedImage(encoded.getvalue())
