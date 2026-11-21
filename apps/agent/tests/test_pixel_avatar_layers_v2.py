from concurrent.futures import ThreadPoolExecutor
from functools import reduce
import io

from PIL import Image, ImageChops
import pytest

from buildurprofile_agent.contracts import PixelAvatarTraitsV2
from buildurprofile_agent.skills import pixel_avatar_layers as legacy
from buildurprofile_agent.skills import pixel_avatar_layers_v2 as detailed


def traits(**overrides):
    return PixelAvatarTraitsV2.model_validate({
        "subject": "usable",
        "hair_length": "unknown",
        "hair_tie": "unknown",
        "bangs": "unknown",
        "hair_color": "unknown",
        "glasses": "unknown",
        "headwear": "unknown",
        "earwear": "unknown",
        "neckwear": "unknown",
    } | overrides)


def image_for(**overrides):
    result = detailed.render_detailed_pixel_avatar(traits(**overrides))
    assert result is not None
    with Image.open(io.BytesIO(result.bytes)) as image:
        assert image.format == "PNG"
        assert image.mode == "RGBA" and image.size == (1254, 1254)
        return image.copy()


@pytest.mark.parametrize("overrides", (
    {},
    {"hair_length": "short", "hair_tie": "loose", "hair_color": "dark", "glasses": "none"},
    {"hair_tie": "other", "hair_color": "vivid", "glasses": "other"},
    {"subject": "unclear", "hair_length": "long", "hair_color": "pink", "glasses": "frames"},
))
def test_no_applied_changes_have_no_candidate(overrides):
    assert detailed.render_detailed_pixel_avatar(traits(**overrides)) is None


def test_single_ponytail_extends_above_left_temple():
    ponytail = image_for(hair_length="long", hair_tie="single_ponytail", bangs="straight")
    loose = image_for(hair_length="long", hair_tie="loose", bangs="straight")
    assert ponytail.getpixel((315, 180))[3] == 255
    assert loose.getpixel((315, 180))[3] == 0
    assert ponytail.getpixel((470, 950)) != loose.getpixel((470, 950))


@pytest.mark.parametrize(("tie", "shoulder_point", "long_point"), (
    ("single_ponytail", (290, 753), (295, 827)),
    ("twin_tails", (420, 818), (420, 955)),
))
def test_tied_styles_preserve_observed_length(tie, shoulder_point, long_point):
    styles = ("short", "shoulder_length", "long", "unknown")
    short, shoulder, long, unknown = [
        image_for(hair_length=style, hair_tie=tie, bangs="straight") for style in styles
    ]
    base = legacy.load_pixel_avatar_layers()._image("base")
    assert short.getpixel(shoulder_point) == base.getpixel(shoulder_point)
    assert shoulder.getpixel(shoulder_point) != short.getpixel(shoulder_point)
    assert shoulder.getpixel(long_point) == base.getpixel(long_point)
    assert long.getpixel(long_point) != shoulder.getpixel(long_point)
    assert long.tobytes() == unknown.tobytes()


def test_short_twins_show_compact_tails_on_both_sides():
    twins = image_for(hair_length="short", hair_tie="twin_tails")
    assert twins.getpixel((300, 615))[3] == 255
    assert twins.getpixel((950, 615))[3] == 255


def test_shoulder_hair_frames_face_without_long_ends():
    short = image_for(hair_length="short", bangs="curtain")
    shoulder = image_for(hair_length="shoulder_length", bangs="curtain")
    long = image_for(hair_length="long", bangs="curtain")
    assert shoulder.getpixel((396, 811)) == long.getpixel((396, 811))
    assert short.getpixel((396, 811)) != shoulder.getpixel((396, 811))
    assert shoulder.getpixel((470, 960)) == short.getpixel((470, 960))
    assert long.getpixel((470, 960)) != shoulder.getpixel((470, 960))


def test_bangs_vary_independently_of_length():
    styles = ("none", "straight", "side_swept", "curtain")
    crops = ((451, 374, 807, 525), (330, 635, 920, 850))
    known = [image_for(hair_length="shoulder_length", bangs=style) for style in styles]
    assert len({image.crop(crops[0]).tobytes() for image in known}) == len(styles)
    assert len({image.crop(crops[1]).tobytes() for image in known}) == 1
    assert known[0].getpixel((632, 439)) == (243, 180, 137, 255)
    assert known[1].getpixel((632, 439)) != known[0].getpixel((632, 439))


@pytest.mark.parametrize(("overrides", "position"), (
    ({"hair_tie": "single_ponytail", "bangs": "straight"}, (423, 407)),
    ({"hair_length": "shoulder_length", "bangs": "curtain"}, (817, 402)),
))
def test_fringe_joins_crown_without_skin_gaps(overrides, position):
    fringe = image_for(**overrides)
    assert fringe.getpixel(position)[0] < 100


def test_pink_long_hair_keeps_the_independent_frames():
    pink = image_for(hair_length="long", hair_color="pink", bangs="side_swept", glasses="frames")
    no_frames = image_for(hair_length="long", hair_color="pink", bangs="side_swept")
    red, green, blue, alpha = pink.getpixel((640, 216))
    assert red > blue > green and alpha == 255
    assert pink.getpixel((480, 502)) != no_frames.getpixel((480, 502))
    assert pink.getpixel((640, 216)) == no_frames.getpixel((640, 216))


def test_named_color_palettes_recolor_the_same_hair_geometry():
    colors = ("brown", "pink", "red", "purple", "blue", "blond", "gray_white")
    images = [image_for(hair_length="long", bangs="curtain", hair_color=color) for color in colors]
    assert len({image.getpixel((640, 216)) for image in images}) == len(colors)
    assert len({image.getchannel("A").tobytes() for image in images}) == 1


@pytest.mark.parametrize("overrides", (
    {"hair_length": "long", "hair_tie": "single_ponytail", "bangs": "straight"},
    {"hair_length": "long", "hair_color": "pink", "bangs": "side_swept", "glasses": "frames"},
    {"hair_length": "shoulder_length", "bangs": "curtain"},
    {"hair_length": "short", "hair_tie": "twin_tails", "bangs": "none", "hair_color": "blond"},
))
def test_detailed_art_preserves_protected_rgba(overrides):
    layers = legacy.load_pixel_avatar_layers()
    image = image_for(**overrides)
    difference = reduce(ImageChops.lighter, ImageChops.difference(image, layers._image("base")).split())
    allowed = layers._image("allow-recolor")
    if overrides.get("glasses") == "frames":
        allowed = ImageChops.lighter(allowed, layers._image("allow-glasses"))
    assert difference.getbbox()
    assert not ImageChops.multiply(difference, ImageChops.invert(allowed)).getbbox()
    assert not ImageChops.multiply(difference, layers._image("hard-lock")).getbbox()
    assert not any(image.getchannel("A").histogram()[1:255])


def test_parallel_rendering_is_deterministic():
    selections = (
        traits(hair_length="long", hair_tie="single_ponytail", bangs="straight"),
        traits(hair_length="long", hair_color="pink", bangs="side_swept", glasses="frames"),
        traits(hair_length="shoulder_length", bangs="curtain"),
    )

    def render(selection):
        return detailed.render_detailed_pixel_avatar(selection).bytes

    expected = [render(selection) for selection in selections]
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert list(pool.map(render, selections * 2)) == expected * 2
