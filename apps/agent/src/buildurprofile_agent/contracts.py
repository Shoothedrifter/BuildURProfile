"""Version-one JSON contracts shared with the Node task API.

Node validates before enqueueing; these models validate again at the trust boundary.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .skills.assessment import score_answers


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Profile(StrictModel):
    name: str = Field(min_length=1, max_length=12000)
    role: str = Field(max_length=12000)
    location: str = Field(max_length=12000)
    availability: str = Field(max_length=12000)
    intro: str = Field(max_length=12000)
    summary: str = Field(max_length=12000)
    email: str = Field(max_length=12000)


class Expertise(StrictModel):
    eyebrow: str = Field(max_length=12000)
    headline: str = Field(max_length=12000)
    summary: str = Field(max_length=12000)
    skills: list[str] = Field(max_length=100)
    disciplines: list[str] = Field(max_length=100)


class ProjectCard(StrictModel):
    id: str = Field(max_length=100)
    index: str = Field(max_length=30)
    title: str = Field(max_length=12000)
    category: str = Field(max_length=12000)
    year: str = Field(max_length=30)
    description: str = Field(max_length=12000)
    tags: list[str] = Field(max_length=100)
    visual: Literal["mint", "lilac", "peach"]
    image: str | None = None
    link: str | None = None


class ResumeContent(StrictModel):
    profile: Profile
    expertise: Expertise
    projects: list[ProjectCard] = Field(max_length=100)
    workExperience: list[str] = Field(default_factory=list, max_length=100)
    campusExperience: list[str] = Field(default_factory=list, max_length=100)
    education: list[str] = Field(default_factory=list, max_length=100)


class GenerationBriefV1(StrictModel):
    role: Literal["ui-ux-designer", "frontend-creative-developer", "brand-motion-copy"]
    answers: dict[str, int]
    content: ResumeContent

    @field_validator("answers")
    @classmethod
    def complete_assessment(cls, value: dict[str, int]) -> dict[str, int]:
        score_answers(value)
        return value


class StyleVector(StrictModel):
    E: float
    K: float
    P: float
    S: float
    PChoice: Literal["cool", "neutral", "warm", "vivid"]

    @field_validator("E", "K", "P", "S")
    @classmethod
    def bounded(cls, value: float) -> float:
        if not 0 <= value <= 1:
            raise ValueError("Style score out of range")
        return value


class Marquee(StrictModel):
    direction: Literal["left", "right"]
    speed: int
    bindToScroll: bool
    rows: int
    tileSize: int
    pauseOnHover: bool
    items: list[str | dict] = Field(default_factory=list, max_length=100)


class StackedCards(StrictModel):
    scaleStep: float
    offsetStep: int
    stickyTop: int
    layout: Literal["center", "offset", "fan"]
    cardRadius: int
    enableTilt: bool
    autoPlay: bool


class DesignConfigV1(StrictModel):
    styleVector: StyleVector
    skin: Literal["dark-tech", "light-minimal", "high-saturation"]
    marquee: Marquee
    stackedCards: StackedCards
    content: ResumeContent


def clean_brief(raw: object) -> dict:
    return GenerationBriefV1.model_validate(raw).model_dump(exclude_none=True)


def clean_config(raw: object) -> dict:
    return DesignConfigV1.model_validate(raw).model_dump(exclude_none=True)
