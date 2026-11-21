from concurrent.futures import ThreadPoolExecutor
from functools import reduce
from hashlib import sha256
import io

from PIL import Image, ImageChops
import pytest

from buildurprofile_agent.contracts import PixelAvatarTraitsV2, PixelAvatarTraitsV3
from buildurprofile_agent.skills import pixel_avatar_layers as legacy
from buildurprofile_agent.skills import pixel_avatar_layers_v2 as detailed


_BLUE_HAIR = {(41, 60, 102, 255), (70, 99, 154, 255), (112, 147, 191, 255)}


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


def layered_image_for(**overrides):
    selection = PixelAvatarTraitsV3.model_validate(
        traits().model_dump() | {"hair_layers": "unknown"} | overrides
    )
    result = detailed.render_layered_hair_pixel_avatar(selection)
    assert result is not None
    with Image.open(io.BytesIO(result.bytes)) as image:
        assert image.format == "PNG"
        assert image.mode == "RGBA" and image.size == (1254, 1254)
        return image.copy()


def test_wispy_bangs_have_distinct_tapered_strands_and_open_forehead():
    wispy = layered_image_for(hair_length="long", hair_tie="loose", hair_color="blue", bangs="wispy")
    no_bangs = image_for(hair_length="long", hair_tie="loose", hair_color="blue", bangs="none")
    for tip in ((585, 495), (657, 513), (747, 495)):
        assert wispy.getpixel(tip) in _BLUE_HAIR
    for gap in ((621, 477), (693, 477)):
        assert wispy.getpixel(gap) == no_bangs.getpixel(gap)
        assert wispy.getpixel(gap) not in _BLUE_HAIR


def test_long_loose_layers_frame_the_face_and_reach_below_the_shoulders():
    short = image_for(hair_length="short", hair_color="blue", bangs="none")
    long = layered_image_for(
        hair_length="long", hair_tie="loose", hair_color="blue", bangs="wispy",
        hair_layers="face_framing",
    )
    for point in ((459, 765), (801, 765)):
        assert long.getpixel(point) in _BLUE_HAIR
    for point in ((477, 1035), (765, 1017)):
        assert short.getpixel(point) not in _BLUE_HAIR
        assert long.getpixel(point) in _BLUE_HAIR

    layers = legacy.load_pixel_avatar_layers()
    base = layers._image("base")
    difference = reduce(ImageChops.lighter, ImageChops.difference(long, base).split())
    assert not ImageChops.multiply(difference, layers._image("hard-lock")).getbbox()
    assert not any(long.getchannel("A").histogram()[1:255])


@pytest.mark.parametrize("hair_layers", ("none", "unknown"))
def test_long_straight_hair_without_face_framing_uses_original_layers(hair_layers):
    choices = {"hair_length": "long", "hair_tie": "loose", "hair_color": "blue", "bangs": "straight"}
    assert layered_image_for(**choices, hair_layers=hair_layers).tobytes() == image_for(**choices).tobytes()


def test_detailed_v9_blue_hair_output_remains_pinned():
    original = image_for(hair_color="blue", hair_length="long", bangs="straight")
    assert sha256(original.tobytes()).hexdigest() == "c0bb4086111c43699ce307f538cc457b906f472b46ca78b2791aa25245afb783"


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
