"""Python implementation of packages/skills/src/assessment.ts.

Keep this module deterministic and covered by cross-language golden fixtures.
"""

from __future__ import annotations

from collections.abc import Mapping


QUESTIONS: tuple[tuple[str, str, tuple[int, ...]], ...] = (
    ("e-presence", "E", (0, 1, 2, 3, 4)),
    ("e-type", "E", (0, 1, 2, 3, 4)),
    ("k-pace", "K", (0, 1, 2, 3, 4)),
    ("k-cards", "K", (0, 1, 2, 3, 4)),
    ("p-tone", "P", (2, 2, 2, 2)),
    ("p-strength", "P", (0, 1, 2, 3, 4)),
    ("s-browse", "S", (0, 1, 2, 3, 4)),
    ("s-control", "S", (0, 1, 2, 3, 4)),
)
PALETTE_TONES = ("cool", "neutral", "warm", "vivid")


def score_answers(answers: Mapping[str, int]) -> dict[str, float | str]:
    if set(answers) != {question_id for question_id, _, _ in QUESTIONS}:
        raise ValueError("The assessment needs exactly eight answers")
    totals = {axis: 0 for axis in "EKPS"}
    minimums = {axis: 0 for axis in "EKPS"}
    maximums = {axis: 0 for axis in "EKPS"}
    for question_id, axis, points in QUESTIONS:
        index = answers[question_id]
        if type(index) is not int or not 0 <= index < len(points):
            raise ValueError(f"Invalid assessment answer: {question_id}")
        totals[axis] += points[index]
        minimums[axis] += min(points)
        maximums[axis] += max(points)
    vector: dict[str, float | str] = {}
    for axis in "EKPS":
        spread = maximums[axis] - minimums[axis]
        vector[axis] = (totals[axis] - minimums[axis]) / spread if spread else 0.5
    vector["PChoice"] = PALETTE_TONES[answers["p-tone"]]
    return vector
