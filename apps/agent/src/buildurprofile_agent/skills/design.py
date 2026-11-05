"""Python implementation of packages/skills/src/mapping.ts."""

from __future__ import annotations

import math
from collections.abc import Mapping


ROLE_DEFAULTS = {
    "ui-ux-designer": dict(rows=1, speedBonus=0, tileBonus=0, scaleBonus=0,
                           offsetBonus=0, radiusBonus=0, stickyTop=104,
                           layout="center", direction="left"),
    "frontend-creative-developer": dict(rows=2, speedBonus=8, tileBonus=8, scaleBonus=0.01,
                                        offsetBonus=3, radiusBonus=2, stickyTop=108,
                                        layout="offset", direction="left"),
    "brand-motion-copy": dict(rows=2, speedBonus=4, tileBonus=20, scaleBonus=0.015,
                              offsetBonus=5, radiusBonus=6, stickyTop=100,
                              layout="fan", direction="right"),
}


def _unit(value: object) -> float:
    return min(1.0, max(0.0, float(value))) if isinstance(value, (float, int)) and math.isfinite(value) else 0.5


def _js_round(value: float) -> int:
    # All geometry inputs are non-negative; JavaScript Math.round uses half-up here.
    return math.floor(value + 0.5)


def style_to_config(vector: Mapping[str, object], role: str) -> dict:
    if role not in ROLE_DEFAULTS:
        raise ValueError("Unknown job role")
    tone = vector.get("PChoice")
    if tone not in ("cool", "neutral", "warm", "vivid"):
        raise ValueError("Unknown palette tone")
    normalized = {axis: _unit(vector.get(axis)) for axis in "EKPS"}
    normalized["PChoice"] = tone
    defaults = ROLE_DEFAULTS[role]
    e, k, p, s = (normalized[axis] for axis in "EKPS")
    return {
        "styleVector": normalized,
        "skin": "dark-tech" if tone == "cool" else "high-saturation" if tone == "vivid" else "light-minimal",
        "marquee": {
            "direction": defaults["direction"],
            "speed": 32 + _js_round(k * 60) + defaults["speedBonus"],
            "bindToScroll": s >= 0.65,
            "rows": min(4, defaults["rows"] + _js_round(e)),
            "tileSize": 216 + _js_round(e * 64) + defaults["tileBonus"],
            "pauseOnHover": s >= 0.35,
        },
        "stackedCards": {
            "scaleStep": float(f"{0.04 + k * 0.105 + defaults['scaleBonus']:.3f}"),
            "offsetStep": 14 + _js_round(k * 18) + defaults["offsetBonus"],
            "stickyTop": defaults["stickyTop"],
            "layout": defaults["layout"],
            "cardRadius": 12 + _js_round(p * 18) + defaults["radiusBonus"],
            "enableTilt": s >= 0.65,
            "autoPlay": s < 0.65,
        },
        "content": {
            "profile": dict.fromkeys(("name", "role", "location", "availability", "intro", "summary", "email"), ""),
            "expertise": {"eyebrow": "", "headline": "", "summary": "", "skills": [], "disciplines": []},
            "projects": [],
        },
    }
