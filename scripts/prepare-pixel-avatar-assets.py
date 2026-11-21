#!/usr/bin/env python3
"""Build the reviewed Pixel World v2 layers from the four pinned design SVGs."""

import argparse
from functools import reduce
from hashlib import sha256
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops, ImageColor, ImageDraw

SIZE = (1254, 1254)
SOURCES = {
    "pixel-world-base.svg": "21c0d92bc051a2d8f51372930d0823a01598b70e10ef6ba09b632663d2c10fc7",
    "glasses.svg": "757f8bbc5d8526815408298df125230ed7ee2f67a74063dbb62b1f3565f11fa6",
    "long-hair.svg": "294f4b419a910ca8e4953ad7b4f2d64054ac4b637d23bc58f26e68c8ab098aad",
    "twin-tails.svg": "e4ce1d489bb88244c9d94f1b01875558175180f8f03c438a034ef32f555d0ac4",
}
SVG = "{http://www.w3.org/2000/svg}"
RECT_PATH = re.compile(r"M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z")
HEX_COLOR = re.compile(r"#[0-9a-f]{6}")

SHADES = {
    "shadow": ("1b1519", "271d1a", "292124", "2d1f28", "2f212a", "30212b", "30222b",
               "31201f", "31222c", "31232b", "32242a", "32242c", "33222a", "33232c",
               "33242c", "35252d", "392424"),
    "mid": ("3e2c33", "4b353d"),
    "light": ("563a49", "5c404e", "5f4350"),
}
HAIR_COLORS = tuple(color for shades in SHADES.values() for color in shades)
SKIN_COLORS = (
    "fbccab", "fbc69d", "fabe95", "f9bd95", "fabc93", "f7bd95", "f6bc93", "f8ba92",
    "f6b88e", "f3b489", "f5ba90", "e0ab89", "e1a075", "c47359", "df8581",
)


def read_design(path, source_name):
    content = path.read_bytes()
    if sha256(content).hexdigest() != SOURCES[source_name]:
        raise ValueError(f"Unexpected source checksum: {source_name}")
    root = ET.fromstring(content)
    if root.tag != SVG + "svg" or any(
        root.get(key) != value
        for key, value in {"width": "1254", "height": "1254", "viewBox": "0 0 1254 1254"}.items()
    ):
        raise ValueError(f"Unexpected canvas: {source_name}")

    output = Image.new("RGBA", SIZE)
    draw = ImageDraw.Draw(output)
    for element in root:
        if element.tag in (SVG + "title", SVG + "desc"):
            continue
        if (element.tag != SVG + "path" or set(element.attrib) != {"fill", "d"}
                or len(element) or not HEX_COLOR.fullmatch(element.attrib["fill"])):
            raise ValueError(f"Export flat layered assets from the design tool: {source_name}")
        shape = element.attrib["d"]
        position = 0
        for rectangle in RECT_PATH.finditer(shape):
            x, y, width, height, closing_width = map(int, rectangle.groups())
            if (rectangle.start() != position or width != closing_width or not width or not height
                    or x + width > SIZE[0] or y + height > SIZE[1]):
                raise ValueError(f"Invalid flat rectangle: {source_name}")
            draw.rectangle((x, y, x + width - 1, y + height - 1), fill=element.attrib["fill"])
            position = rectangle.end()
        if not position or position != len(shape):
            raise ValueError(f"Export flat layered assets from the design tool: {source_name}")
    return output


def union(*masks):
    return reduce(ImageChops.lighter, masks)


def subtract(first, second):
    return ImageChops.subtract(first, second)


def rectangle(box):
    result = Image.new("L", SIZE)
    ImageDraw.Draw(result).rectangle(box, fill=255)
    return result


def polygon(points):
    result = Image.new("L", SIZE)
    ImageDraw.Draw(result).polygon(points, fill=255)
    return result


def color_mask(image, colors):
    rgba = {bytes((*ImageColor.getrgb("#" + color), 255)) for color in colors}
    # Each pixel is checked as RGBA so transparent pixels cannot match a color.
    raw = image.tobytes()
    return Image.frombytes("L", SIZE, bytes(
        255 if raw[index:index + 4] in rgba else 0 for index in range(0, len(raw), 4)
    ))


def review_masks(base):
    # These bounds were traced from the design sheets. The strand envelopes
    # include the loose strands at the sleeves and the two locks at the shoulders.
    hair = union(
        polygon(((246, 134), (1009, 134), (1009, 763), (866, 825), (710, 825),
                 (711, 780), (769, 744), (813, 705), (845, 646), (858, 602),
                 (821, 539), (799, 533), (459, 533), (434, 546), (402, 599),
                 (419, 670), (445, 708), (484, 750), (537, 780), (538, 825),
                 (390, 825), (246, 764))),
        polygon(((295, 759), (537, 759), (537, 854), (499, 854), (499, 999),
                 (521, 999), (521, 1042), (383, 1042), (383, 1002), (363, 1002),
                 (363, 876), (295, 876))),
        polygon(((292, 810), (359, 810), (359, 890), (351, 890), (351, 916),
                 (332, 916), (332, 932), (304, 932), (304, 981), (279, 981),
                 (279, 1042), (246, 1042), (246, 902), (269, 902), (269, 869),
                 (292, 869))),
        polygon(((716, 759), (957, 759), (957, 876), (891, 876), (891, 1002),
                 (869, 1002), (869, 1042), (732, 1042), (732, 999), (756, 999),
                 (756, 854), (716, 854))),
        polygon(((907, 810), (961, 810), (961, 885), (988, 885), (988, 939),
                 (1009, 939), (1009, 1042), (976, 1042), (976, 982), (947, 982),
                 (947, 917), (929, 917), (929, 895), (907, 895))),
    )
    # The glasses are the two rectangular frames, the temples and the bridge.
    # The lens openings are carved out before any image data are inspected.
    glasses = subtract(
        union(rectangle((419, 495, 596, 629)), rectangle((673, 493, 848, 629)),
              rectangle((394, 519, 418, 539)), rectangle((849, 519, 879, 539)),
              rectangle((596, 515, 673, 537))),
        union(rectangle((439, 515, 576, 611)), rectangle((694, 515, 828, 611))),
    )
    eyes = union(rectangle((454, 535, 576, 596)), rectangle((699, 535, 824, 596)))
    features = union(eyes, rectangle((428, 633, 827, 716)), rectangle((548, 778, 706, 871)))
    skin = ImageChops.multiply(color_mask(base, SKIN_COLORS), rectangle((0, 526, 1253, 1253)))
    hold = union(features, subtract(skin, glasses), ImageChops.invert(union(hair, glasses)))

    hair = subtract(hair, union(features, skin))
    opaque = base.getchannel("A")
    short_hair = ImageChops.multiply(
        color_mask(base, HAIR_COLORS),
        ImageChops.multiply(hair, rectangle((0, 134, 1253, 612))),
    )
    # Remove the base raster's tracing seams only in the fringe area
    # revealed by a replacement hairstyle.
    fringe_traces = ImageChops.multiply(
        color_mask(base, ("ac9a7f", "b39f84", "b8a489", "cfbfac", "8b6c5d", "c47359")),
        rectangle((447, 361, 812, 490)),
    )
    return {
        "hard-lock": hold,
        "allow-back": ImageChops.multiply(hair, ImageChops.invert(opaque)),
        "allow-front": ImageChops.multiply(hair, opaque),
        "allow-erase": short_hair,
        "allow-restore": union(
            ImageChops.multiply(short_hair, rectangle((390, 330, 868, 612))), fringe_traces,
        ),
        "allow-recolor": hair,
        "allow-glasses": subtract(glasses, hold),
    }


def isolate(image, mask):
    output = Image.new("RGBA", SIZE)
    output.paste(image, mask=mask)
    return output


def extract_layers(designs):
    base = designs["pixel-world-base.svg"]
    approval = review_masks(base)
    short_hair = approval["allow-erase"]
    output = {"base": base, **approval}
    for name in ("long", "twin"):
        variant = designs[{"long": "long-hair.svg", "twin": "twin-tails.svg"}[name]]
        hair = color_mask(variant, HAIR_COLORS)
        existing = variant.getchannel("A")
        output[f"{name}-erase"] = ImageChops.multiply(short_hair, ImageChops.invert(existing))
        exposed_skin = color_mask(variant, SKIN_COLORS)
        if name == "long":
            # The long-hair reference has a one-pixel taupe tracing seam
            # through the exposed forehead, outside the regular skin palette.
            exposed_skin = union(exposed_skin, rectangle((557, 369, 557, 413)))
        output[f"{name}-restore"] = ImageChops.multiply(approval["allow-restore"], exposed_skin)
        for part in ("back", "front"):
            mask = ImageChops.multiply(hair, approval[f"allow-{part}"])
            output[f"{name}-{part}"] = isolate(variant, mask)
        for shade, colors in SHADES.items():
            output[f"{name}-{shade}"] = ImageChops.multiply(
                color_mask(variant, colors), approval["allow-recolor"],
            )
    for shade, colors in SHADES.items():
        output[f"short-{shade}"] = ImageChops.multiply(color_mask(base, colors), short_hair)
    glasses = designs["glasses.svg"]
    frame = color_mask(glasses, HAIR_COLORS)
    output["glasses"] = isolate(glasses, ImageChops.multiply(frame, approval["allow-glasses"]))
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True, help="Path to the default Pixel World SVG")
    parser.add_argument("--variants-dir", type=Path, required=True, help="Directory with the three source SVGs")
    parser.add_argument("--output-dir", type=Path, required=True, help="Destination for the generated PNGs and manifest")
    args = parser.parse_args()

    designs = {"pixel-world-base.svg": read_design(args.base, "pixel-world-base.svg")}
    for name in SOURCES.keys() - designs.keys():
        designs[name] = read_design(args.variants_dir / name, name)
    images = extract_layers(designs)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, image in sorted(images.items()):
        path = args.output_dir / f"{name}.png"
        image.save(path, format="PNG", optimize=True)
        files[path.name] = sha256(path.read_bytes()).hexdigest()
    manifest = {"version": "2.0.0", "sources": SOURCES, "files": files}
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )


if __name__ == "__main__":
    main()
