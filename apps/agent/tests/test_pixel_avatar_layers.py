from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import io
import json
from pathlib import Path
import shutil

from PIL import Image, ImageChops
import pytest

from buildurprofile_agent.contracts import PixelAvatarTraits
from buildurprofile_agent.skills import pixel_avatar_layers as layer_module


AGENT = Path(__file__).resolve().parents[1]
PACK = AGENT / "src/buildurprofile_agent/resources/pixel-avatar-v1"
SOURCE_DIGESTS = {
    "pixel-world-base.svg": "21c0d92bc051a2d8f51372930d0823a01598b70e10ef6ba09b632663d2c10fc7",
    "glasses.svg": "757f8bbc5d8526815408298df125230ed7ee2f67a74063dbb62b1f3565f11fa6",
    "long-hair.svg": "294f4b419a910ca8e4953ad7b4f2d64054ac4b637d23bc58f26e68c8ab098aad",
    "twin-tails.svg": "e4ce1d489bb88244c9d94f1b01875558175180f8f03c438a034ef32f555d0ac4",
}
SIZE = (1254, 1254)


def test_assets_bundle_pins_the_source_and_every_runtime_resource():
    assert (PACK / "manifest.json").is_file(), "The reviewed layer pack is missing"
    manifest = json.loads((PACK / "manifest.json").read_bytes())
    assert manifest["version"] == "2.0.0"
    assert manifest["sources"] == SOURCE_DIGESTS
    base_svg = AGENT.parents[1] / "apps/web/public/pixel-world-base.svg"
    assert sha256(base_svg.read_bytes()).hexdigest() == SOURCE_DIGESTS[base_svg.name]
    assert set(manifest["files"]) == {path.name for path in PACK.glob("*.png")}
    with Image.open(PACK / "base.png") as base:
        expected_rgba = "551005134415b10c20c26fee2f7806cd9e9aabc46c350be561e68c761aa71c9f"
        assert sha256(base.tobytes()).hexdigest() == expected_rgba
    for name, digest in manifest["files"].items():
        path = PACK / name
        assert sha256(path.read_bytes()).hexdigest() == digest
        with Image.open(path) as image:
            assert image.size == SIZE
            alpha = image if image.mode == "L" else image.getchannel("A")
            assert not any(alpha.histogram()[1:255])


@pytest.fixture
def test_pack(tmp_path):
    path = tmp_path / "pack"
    shutil.copytree(PACK, path)
    return path


def use_pack(monkeypatch, pack, *, repin_manifest=True):
    monkeypatch.setattr(layer_module, "_pack_root", lambda: pack)
    if repin_manifest:
        digest = sha256((pack / "manifest.json").read_bytes()).hexdigest()
        monkeypatch.setattr(layer_module, "_MANIFEST_SHA256", digest)
    layer_module.load_pixel_avatar_layers.cache_clear()


def replace_resource(pack, name, content):
    (pack / name).write_bytes(content)
    manifest_file = pack / "manifest.json"
    manifest = json.loads(manifest_file.read_bytes())
    manifest["files"][name] = sha256(content).hexdigest()
    manifest_file.write_text(json.dumps(manifest))


def png_bytes(image):
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_assets_loads_packaged_png_and_masks():
    assert layer_module.load_pixel_avatar_layers() is not None


@pytest.mark.parametrize("content", [b"not a png", png_bytes(Image.new("RGBA", (8, 8)))])
def test_assets_rejects_invalid_png_even_when_its_checksum_matches(
    monkeypatch, test_pack, content,
):
    replace_resource(test_pack, "base.png", content)
    use_pack(monkeypatch, test_pack)
    with pytest.raises(PermissionError):
        layer_module.load_pixel_avatar_layers()


def test_assets_rejects_an_unpinned_manifest(monkeypatch, test_pack):
    with Image.open(test_pack / "long-restore.png") as mask:
        mask.putpixel((557, 400), 0)
        replace_resource(test_pack, "long-restore.png", png_bytes(mask))
    use_pack(monkeypatch, test_pack, repin_manifest=False)
    with pytest.raises(PermissionError):
        layer_module.load_pixel_avatar_layers()


def test_assets_rejects_hash_mismatch(monkeypatch, test_pack):
    (test_pack / "glasses.png").write_bytes((test_pack / "base.png").read_bytes())
    use_pack(monkeypatch, test_pack)
    with pytest.raises(PermissionError):
        layer_module.load_pixel_avatar_layers()


def test_assets_rejects_manifest_path_outside_pack(monkeypatch, test_pack):
    path = test_pack / "manifest.json"
    manifest = json.loads(path.read_bytes())
    manifest["files"]["../outside.png"] = manifest["files"].pop("base.png")
    path.write_text(json.dumps(manifest))
    use_pack(monkeypatch, test_pack)
    with pytest.raises(PermissionError):
        layer_module.load_pixel_avatar_layers()


def test_assets_rejects_a_resource_symlink(monkeypatch, test_pack, tmp_path):
    outside = tmp_path / "outside.png"
    (test_pack / "base.png").rename(outside)
    (test_pack / "base.png").symlink_to(outside)
    use_pack(monkeypatch, test_pack)
    with pytest.raises(PermissionError):
        layer_module.load_pixel_avatar_layers()


@pytest.mark.parametrize(
    ("asset", "x", "y", "value"),
    [
        ("glasses.png", 540, 560, (10, 12, 14, 255)),
        ("long-erase.png", 540, 560, 255),
        ("long-front.png", 610, 960, (10, 12, 14, 255)),
        ("long-mid.png", 587, 570, 255),
        ("allow-glasses.png", 540, 560, 255),
        ("hard-lock.png", 540, 560, 0),
    ],
)
def test_assets_rejects_writes_or_approval_changes_in_fixed_regions(
    monkeypatch, test_pack, asset, x, y, value,
):
    with Image.open(test_pack / asset) as layer:
        layer.putpixel((x, y), value)
        replace_resource(test_pack, asset, png_bytes(layer))
    use_pack(monkeypatch, test_pack)
    with pytest.raises(PermissionError):
        layer_module.load_pixel_avatar_layers()


@pytest.mark.parametrize(
    ("overrides", "expected_masks", "expected_pixels"),
    [
        ({}, (), ()),
        ({"hair_style": "long"}, ("back", "front", "erase", "restore"), ((310, 650), (615, 370), (470, 955))),
        ({"hair_style": "twin_tails"}, ("back", "front", "erase", "restore"), ((305, 550), (555, 380), (405, 960))),
        (
            {"hair_style": "twin_tails", "glasses": "frames"},
            ("back", "front", "erase", "restore", "glasses"),
            ((405, 960), (480, 502), (825, 621)),
        ),
        (
            {"hair_style": "long", "hair_color": "brown"},
            ("back", "front", "erase", "restore", "recolor"),
            ((310, 650), (640, 217), (470, 955)),
        ),
        ({"hair_style": "unknown", "glasses": "frames"}, ("glasses",), ((480, 502), (825, 621))),
        ({"headwear": "hat", "earwear": "earring", "neckwear": "choker"}, (), ()),
        ({"hair_style": "other", "hair_color": "brown"}, ("recolor",), ((640, 217), (487, 311))),
    ],
)
def test_composition_changes_only_approved_pixels(overrides, expected_masks, expected_pixels):
    layers = layer_module.load_pixel_avatar_layers()
    selection = layer_module.select_pixel_layers(make_traits(**overrides), layers)
    assert selection.is_default is (not expected_masks)
    output = layer_module.compose_pixel_avatar(selection, layers)
    with Image.open(io.BytesIO(output.bytes)) as image, Image.open(PACK / "base.png") as base:
        assert image.format == "PNG"
        assert image.mode == "RGBA" and image.size == SIZE
        assert image.getpixel((0, 0)) == (0, 0, 0, 0)
        assert image.getpixel((552, 565)) == base.getpixel((552, 565))
        assert image.getpixel((780, 578)) == base.getpixel((780, 578))
        assert image.getpixel((633, 695)) == base.getpixel((633, 695))
        for coordinate in expected_pixels:
            assert image.getpixel(coordinate) != base.getpixel(coordinate)
        if not expected_masks:
            assert image.tobytes() == base.tobytes()
            return
        difference = ImageChops.difference(image, base)
        allowed = Image.new("L", SIZE)
        for name in expected_masks:
            with Image.open(PACK / f"allow-{name}.png") as approval:
                allowed = ImageChops.lighter(allowed, approval)
        with Image.open(PACK / "hard-lock.png") as hard_lock:
            for channel in difference.split():
                assert not ImageChops.multiply(channel, hard_lock).getbbox()
                assert not ImageChops.multiply(channel, ImageChops.invert(allowed)).getbbox()


def make_traits(**overrides):
    return PixelAvatarTraits.model_validate({
        "subject": "usable",
        "hair_style": "short",
        "hair_color": "dark",
        "glasses": "none",
        "headwear": "none",
        "earwear": "none",
        "neckwear": "none",
    } | overrides)


@pytest.mark.parametrize("point", [(557, 400), (624, 420)])
def test_long_hair_restores_forehead_where_original_bangs_were_removed(point):
    layers = layer_module.load_pixel_avatar_layers()
    selection = layer_module.select_pixel_layers(make_traits(hair_style="long"), layers)
    result = layer_module.compose_pixel_avatar(selection, layers)
    with Image.open(io.BytesIO(result.bytes)) as output:
        assert output.getpixel(point) == (246, 184, 142, 255)


def test_composition_rejects_an_rgb_only_change_to_protected_pixels():
    with Image.open(PACK / "base.png") as base, Image.open(PACK / "hard-lock.png") as lock:
        output = base.copy()
        r, g, b, alpha = base.getpixel((552, 565))
        output.putpixel((552, 565), (r - 1, g, b, alpha))
        with pytest.raises(PermissionError):
            layer_module._assert_output_geometry(output, base, Image.new("L", SIZE), lock)


def test_composition_remains_deterministic_with_parallel_requests():
    layers = layer_module.load_pixel_avatar_layers()
    selections = [layer_module.select_pixel_layers(make_traits(**overrides), layers) for overrides in (
        {},
        {"hair_style": "long", "hair_color": "brown"},
        {"hair_style": "twin_tails", "glasses": "frames"},
    )]

    def render(selection):
        return layer_module.compose_pixel_avatar(selection, layers).bytes

    baseline = [render(selection) for selection in selections]
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert list(pool.map(render, selections * 2)) == baseline * 2
    assert len(set(baseline)) == len(selections)
