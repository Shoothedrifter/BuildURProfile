"""Version-one JSON contracts shared with the Node task API.

Node validates before enqueueing; these models validate again at the trust boundary.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import re
from typing import Annotated, Literal
from unicodedata import normalize

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

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
    # 作品卡片对应的简历原文摘录（可选），详情页按需展示
    sourceText: str | None = Field(default=None, max_length=12000)


class ResumeFact(StrictModel):
    key: str = Field(max_length=12000)
    label: str = Field(max_length=12000)
    value: str = Field(max_length=12000)


class ResumeEntry(StrictModel):
    title: str = Field(max_length=12000)
    details: str = Field(max_length=12000)
    facts: list[ResumeFact] = Field(max_length=100)


class StructuredResumeV1(StrictModel):
    version: Literal["resume-v1"]
    basicInfo: list[ResumeFact] = Field(max_length=100)
    jobIntent: list[ResumeFact] = Field(max_length=100)
    selfEvaluation: list[ResumeEntry] = Field(max_length=100)
    education: list[ResumeEntry] = Field(max_length=100)
    workExperience: list[ResumeEntry] = Field(max_length=100)
    projects: list[ResumeEntry] = Field(max_length=100)
    awards: list[ResumeEntry] = Field(max_length=100)
    campusExperience: list[ResumeEntry] = Field(max_length=100)
    skills: list[ResumeEntry] = Field(max_length=100)
    other: list[ResumeEntry] = Field(max_length=100)


class ResumeContent(StrictModel):
    profile: Profile
    expertise: Expertise
    projects: list[ProjectCard] = Field(max_length=100)
    workExperience: list[str] = Field(default_factory=list, max_length=100)
    campusExperience: list[str] = Field(default_factory=list, max_length=100)
    education: list[str] = Field(default_factory=list, max_length=100)
    resume: StructuredResumeV1 | None = None


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

# Private parsing contracts. Never embed these in generation briefs/checkpoints.

ResumeId = Annotated[str, Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]*$')]
ResumeModuleKind = Literal['basicInfo', 'jobIntent', 'selfEvaluation', 'education', 'workExperience', 'projects', 'awards', 'campusExperience', 'skills', 'other']
RESUME_MODULE_MAPPING = dict(zip(ResumeModuleKind.__args__, ['hero-profile', 'job-intent-strip', 'intro-card', 'education-timeline', 'work-timeline', 'project-stacked-cards', 'award-badges', 'campus-timeline', 'skill-tags', 'free-content-card']))
Timestamp = Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')]


class PdfBlock(StrictModel):
    blockId: ResumeId
    page: int = Field(ge=1, le=20)
    bbox: list[float] = Field(min_length=4, max_length=4)
    fontSize: float = Field(ge=0, le=1000)
    bold: bool
    readingOrder: int = Field(ge=0, le=10000)
    text: str = Field(min_length=1, max_length=12000)

    @model_validator(mode='after')
    def valid_box(self):
        import math
        if not all(math.isfinite(n) and 0 <= n <= 100000 for n in self.bbox) or self.bbox[2] < self.bbox[0] or self.bbox[3] < self.bbox[1]:
            raise ValueError('Invalid PDF coordinates')
        return self


class ResumeSourceV1(StrictModel):
    version: Literal['resume-source-v1']
    fileId: ResumeId
    extractionVersion: Literal['pdf-layout-v1']
    uploadedAt: Timestamp
    expiresAt: Timestamp
    pageCount: int = Field(ge=1, le=20)
    blocks: list[PdfBlock] = Field(min_length=1, max_length=5000)

    @model_validator(mode='after')
    def valid_source(self):
        uploaded, expires = (datetime.strptime(t, '%Y-%m-%dT%H:%M:%SZ') for t in [self.uploadedAt, self.expiresAt])
        if expires - uploaded != timedelta(days=30):
            raise ValueError('Retention must be 30 days from upload')
        ids, orders = set(), {}
        for block in self.blocks:
            if block.blockId in ids or block.page > self.pageCount or block.readingOrder <= orders.get(block.page, -1):
                raise ValueError('Duplicate block or invalid reading order/page')
            ids.add(block.blockId)
            orders[block.page] = block.readingOrder
        return self


class PdfBlockV2(PdfBlock):
    sourceType: Literal['pdf', 'ocr']
    ocrConfidence: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode='after')
    def valid_provenance(self):
        if self.sourceType == 'ocr' and self.ocrConfidence is None:
            raise ValueError('OCR block needs confidence')
        if self.sourceType == 'pdf' and self.ocrConfidence is not None:
            raise ValueError('PDF block cannot carry OCR confidence')
        return self


class ResumeSourceV2(ResumeSourceV1):
    version: Literal['resume-source-v2']
    extractionVersion: Literal['pdf-layout-v2']
    blocks: list[PdfBlockV2] = Field(min_length=1, max_length=5000)


class DraftFact(StrictModel):
    key: ResumeId
    label: str = Field(max_length=100)
    value: str = Field(max_length=2000)
    included: bool


class SupplementLink(StrictModel):
    url: str = Field(min_length=1, max_length=2000, pattern=r'^https?://')
    label: str = Field(default='', max_length=80)

    @field_validator('url')
    @classmethod
    def valid_url(cls, value):
        from urllib.parse import urlsplit
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Invalid HTTP(S) URL')
        return value


class SupplementImage(StrictModel):
    imageId: ResumeId
    caption: str = Field(max_length=80)


class ItemSupplements(StrictModel):
    text: str = Field(max_length=500)
    links: list[SupplementLink] = Field(max_length=5)
    images: list[SupplementImage] = Field(max_length=6)


MAX_HIGHLIGHTS = 12
HighlightType = Literal['campus-metric', 'award-total', 'award-tier']
HighlightLevel = Literal['国际级', '国家级', '省部级', '省级', '市级', '校级']
HighlightUnit = Literal['%', '百分点', '人', '人次', '场', '篇', '期', '次', '项', '个', '万']
_HIGHLIGHT_NUMBER = r'^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$'
HighlightNumber = Annotated[str, Field(max_length=32, pattern=_HIGHLIGHT_NUMBER)]
_SINGLE_LINE = r'^[^\x00\r\n]*$'


class HighlightFields(StrictModel):
    id: ResumeId
    type: HighlightType
    label: str = Field(max_length=80, pattern=_SINGLE_LINE)
    unit: HighlightUnit
    level: HighlightLevel | SkipJsonSchema[None] = None

    @model_validator(mode='after')
    def valid_type(self):
        if (self.type == 'award-tier') != (self.level is not None):
            raise ValueError('Invalid highlight level')
        if self.type != 'campus-metric' and self.unit not in {'项', '个', '次'}:
            raise ValueError('Invalid award unit')
        return self


def _check_highlight_value(highlight):
    if not highlight.label.strip() or not re.fullmatch(_HIGHLIGHT_NUMBER, highlight.value):
        raise ValueError('Invalid highlight label or value')
    if highlight.type != 'campus-metric' and ('-' in highlight.value or '.' in highlight.value):
        raise ValueError('Invalid award count')


class DraftPresentationHighlight(HighlightFields):
    value: str = Field(max_length=32, pattern=_SINGLE_LINE)
    selected: bool
    origin: Literal['source', 'user']
    sourceBlockId: ResumeId | SkipJsonSchema[None] = None

    @model_validator(mode='after')
    def valid_provenance_and_selection(self):
        if (self.origin == 'source') != (self.sourceBlockId is not None):
            raise ValueError('Invalid highlight origin')
        if self.selected:
            _check_highlight_value(self)
        return self


def _highlight_key(highlight):
    if highlight.type == 'award-total':
        return highlight.type, None
    if highlight.type == 'award-tier':
        return highlight.type, highlight.level
    label = re.sub(r'\s+', '', normalize('NFKC', highlight.label))
    return highlight.type, re.sub(r'^平台(?=粉丝)', '', label)


def _check_highlight_list(kind, highlights, *, draft=False):
    if highlights is None:
        return
    selected = [h for h in highlights if not draft or h.selected]
    if (not draft and kind not in {'awards', 'campusExperience'}
            or any(kind not in {'awards', 'campusExperience'}
                   or (h.type == 'campus-metric') != (kind == 'campusExperience') for h in selected)):
        raise ValueError('Invalid highlight module')
    if len({h.id for h in highlights}) != len(highlights):
        raise ValueError('Duplicate highlight ID')
    confirmed = [_highlight_key(h) for h in selected]
    if len(set(confirmed)) != len(confirmed):
        raise ValueError('Duplicate confirmed highlight')


class ResumeDraftItem(StrictModel):
    itemId: ResumeId
    order: int = Field(ge=0, le=100)
    title: str = Field(max_length=300)
    details: str = Field(max_length=12000)
    facts: list[DraftFact] = Field(max_length=100)
    sourceBlockIds: list[ResumeId] = Field(max_length=500)
    confidence: float = Field(ge=0, le=1)
    segmentationConfidence: float = Field(ge=0, le=1)
    needsReview: bool
    included: bool
    origin: Literal['agent', 'user']
    supplements: ItemSupplements = Field(default_factory=lambda: ItemSupplements(text='', links=[], images=[]))
    # 条目对应的简历原文摘录（可选），由来源块拼接而来
    sourceText: str | None = Field(default=None, max_length=12000)
    presentationHighlights: Annotated[list[DraftPresentationHighlight], Field(max_length=MAX_HIGHLIGHTS)] | SkipJsonSchema[None] = None

    @model_validator(mode='after')
    def valid_evidence(self):
        if self.origin == 'agent' and not self.sourceBlockIds:
            raise ValueError('Agent item requires evidence')
        if len(set(self.sourceBlockIds)) != len(self.sourceBlockIds) or len({f.key for f in self.facts}) != len(self.facts):
            raise ValueError('Duplicate source/fact')
        if any(h.sourceBlockId is not None and h.sourceBlockId not in self.sourceBlockIds
               for h in self.presentationHighlights or []):
            raise ValueError('Highlight evidence must belong to its item')
        return self


class ResumeDraftSection(StrictModel):
    id: ResumeModuleKind
    kind: ResumeModuleKind
    mappedDesignModule: str
    order: int = Field(ge=0, le=9)
    visible: bool
    items: list[ResumeDraftItem] = Field(max_length=100)

    @model_validator(mode='after')
    def fixed_mapping(self):
        if self.id != self.kind or self.mappedDesignModule != RESUME_MODULE_MAPPING[self.kind]:
            raise ValueError('Invalid fixed design mapping')
        for item in self.items:
            _check_highlight_list(self.kind, item.presentationHighlights, draft=True)
        return self


class ResumeDraftV1(StrictModel):
    version: Literal['resume-draft-v1']
    resumeId: ResumeId
    fileId: ResumeId
    revision: int = Field(ge=0, le=2147483647)
    sections: list[ResumeDraftSection] = Field(min_length=10, max_length=10)

    @model_validator(mode='after')
    def complete_modules(self):
        if {s.kind for s in self.sections} != set(RESUME_MODULE_MAPPING) or len({s.order for s in self.sections}) != 10:
            raise ValueError('Ten unique modules and orders required')
        items = [i.itemId for s in self.sections for i in s.items]
        if len(items) != len(set(items)) or any(len({i.order for i in s.items}) != len(s.items) for s in self.sections):
            raise ValueError('Duplicate item ID/order')
        return self


class ResumeDraftItemV2(ResumeDraftItem):
    editedFields: list[str]
    derivedFromItemId: ResumeId | None = None

    @model_validator(mode='after')
    def valid_edit_fields(self):
        if len(set(self.editedFields)) != len(self.editedFields) or any(
            not re.fullmatch(r'(title|details|sourceText|included|supplements|needsReview|presentationHighlights|fact:[A-Za-z0-9][A-Za-z0-9_-]{0,99})', field)
            for field in self.editedFields
        ):
            raise ValueError('Invalid edit fields')
        return self


class ResumeDraftSectionV2(ResumeDraftSection):
    items: list[ResumeDraftItemV2] = Field(max_length=100)


class ResumeDraftV2(ResumeDraftV1):
    version: Literal['resume-draft-v2']
    sections: list[ResumeDraftSectionV2] = Field(min_length=10, max_length=10)

    @model_validator(mode='after')
    def contiguous_orders(self):
        if sorted(section.order for section in self.sections) != list(range(10)):
            raise ValueError('Noncontiguous section order')
        if any(sorted(item.order for item in section.items) != list(range(len(section.items))) for section in self.sections):
            raise ValueError('Noncontiguous item order')
        return self


def validate_resume_draft(raw: object, source: ResumeSourceV1) -> ResumeDraftV1:
    draft = ResumeDraftV1.model_validate(raw)
    ids = {b.blockId for b in source.blocks}
    if draft.fileId != source.fileId or any(set(i.sourceBlockIds) - ids for s in draft.sections for i in s.items):
        raise ValueError('Evidence does not belong to this PDF')
    return draft


class DisplayLink(SupplementLink):
    label: str = Field(max_length=80)


class DisplaySupplement(StrictModel):
    text: str = Field(max_length=500)
    links: list[DisplayLink] = Field(max_length=5)
    images: list[SupplementImage] = Field(max_length=6)


class ResumeDisplayItem(ResumeEntry):
    itemId: ResumeId
    supplement: DisplaySupplement
    # 条目对应的简历原文摘录（可选），详情页按需展示
    sourceText: str | None = Field(default=None, max_length=12000)


class ResumeDisplaySection(StrictModel):
    kind: ResumeModuleKind
    items: list[ResumeDisplayItem] = Field(max_length=100)


class StructuredResumeV2(StrictModel):
    version: Literal['resume-v2']
    sections: list[ResumeDisplaySection] = Field(max_length=10)

    @model_validator(mode='after')
    def valid_order_and_ids(self):
        kinds = list(RESUME_MODULE_MAPPING)
        orders = [kinds.index(s.kind) for s in self.sections]
        items = [i for s in self.sections for i in s.items]
        if orders != sorted(set(orders)) or len({i.itemId for i in items}) != len(items):
            raise ValueError('Duplicate or unordered modules/items')
        if any(len({f.key for f in i.facts}) != len(i.facts) for i in items):
            raise ValueError('Duplicate facts')
        if len({m.imageId for i in items for m in i.supplement.images}) > 24:
            raise ValueError('Too many images')
        return self


class ResumeContentV2(ResumeContent):
    resume: StructuredResumeV2


class GenerationBriefV2(GenerationBriefV1):
    content: ResumeContentV2


class DesignConfigV2(DesignConfigV1):
    content: ResumeContentV2


class PresentationHighlight(HighlightFields):
    label: str = Field(min_length=1, max_length=80, pattern=_SINGLE_LINE)
    value: HighlightNumber

    @model_validator(mode='after')
    def valid_value(self):
        _check_highlight_value(self)
        return self


class ResumeDisplayItemV3(ResumeDisplayItem):
    order: int = Field(ge=0, le=99)
    presentationHighlights: Annotated[list[PresentationHighlight], Field(max_length=MAX_HIGHLIGHTS)] | SkipJsonSchema[None] = None


class ResumeDisplaySectionV3(ResumeDisplaySection):
    order: int = Field(ge=0, le=9)
    items: list[ResumeDisplayItemV3] = Field(max_length=100)

    @model_validator(mode='after')
    def valid_highlights(self):
        for item in self.items:
            _check_highlight_list(self.kind, item.presentationHighlights)
        return self


class StructuredResumeV3(StrictModel):
    version: Literal['resume-v3']
    sections: list[ResumeDisplaySectionV3] = Field(max_length=10)

    @model_validator(mode='after')
    def valid_order_and_ids(self):
        if len({s.kind for s in self.sections}) != len(self.sections) or len({s.order for s in self.sections}) != len(self.sections):
            raise ValueError('Duplicate module or order')
        if [s.order for s in self.sections] != sorted(s.order for s in self.sections):
            raise ValueError('Sections out of order')
        items = [i for s in self.sections for i in s.items]
        if len({i.itemId for i in items}) != len(items) or any(
            [i.order for i in s.items] != list(range(len(s.items))) for s in self.sections
        ):
            raise ValueError('Duplicate or unordered items')
        if len({m.imageId for i in items for m in i.supplement.images}) > 24:
            raise ValueError('Too many images')
        return self


class ResumeContentV3(ResumeContent):
    resume: StructuredResumeV3


class GenerationBriefV3(GenerationBriefV1):
    content: ResumeContentV3


class DesignConfigV3(DesignConfigV1):
    content: ResumeContentV3


TemplateId = Literal["cyber-creator-v1", "pixel-world-v1", "warm-v1", "minimal-v1", "bold-v1"]


class GenerationBriefV4(StrictModel):
    role: Literal["ui-ux-designer", "frontend-creative-developer", "brand-motion-copy"]
    templateId: TemplateId
    content: ResumeContentV3


class DesignConfigV4(DesignConfigV3):
    templateId: TemplateId
