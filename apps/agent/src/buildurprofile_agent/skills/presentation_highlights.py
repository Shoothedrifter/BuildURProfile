"""Find explicit quantitative statements in one item's anchored evidence."""

import re
from unicodedata import normalize

from buildurprofile_agent.contracts import DraftPresentationHighlight, MAX_HIGHLIGHTS


# Python's re does not offer a Han script character class.
_HAN = r"[\u3005\u3007\u3021-\u3029\u3038-\u303B\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\U00020000-\U000323AF]"
_UNCERTAIN = re.compile(r"未|没有|尚无|预计|计划|目标|有望|争取|力争|预期|暂定|拟|约|待确认")
_RESULT_PREFIX = re.compile(r"^(?:成果|成效|业绩|量化成果)[:：]")
_RESULT_VERB = re.compile(r"^(?:实现|带动|使|推动|促进)")
_PLATFORM_PREFIX = re.compile(r"^平台(?=粉丝)")
_CAMPUS = re.compile(
    rf"({_HAN}{{2,24}}?(?:增长|提升|提高|降低|下降|减少|缩短|达到|突破"
    r"|量|人数|人次|场次|篇数|期数|次数|数))了?[:：]?([+-]?[0-9]+(?:\.[0-9]+)?)(百分点|人次|[%人场篇期次项个万])"
)
_TOTAL = re.compile(
    r"(?:(?:共获(?:得)?|累计获(?:得)?)(?:(学科竞赛|竞赛)奖项?|(学科竞赛|竞赛)|奖项|获奖)?"
    r"|(?:合计|共计)(?:(学科竞赛|竞赛)奖项?|奖项|获奖)|获奖总数|奖项总数"
    r"|(?:(学科竞赛|竞赛)奖项|奖项))[:：]?([0-9]+)([项个次])$"
)
_TOTAL_PREFIX = re.compile(rf"(?:本科期间|在校期间|期间|{_HAN}{{0,12}}(?:期间|共))")
_TIER = re.compile(
    r"(?:(?:其中|包括|包含|分为):?|共获(?:得)?|累计获(?:得)?)?(国际级|国家级|省部级|省级|市级|校级)"
    r"(竞赛)?(奖项|奖)?[:：]?([0-9]+)([项个次])"
)
_AWARD_BREAKDOWN = re.compile(r"(?<=[项个次]):(?=(?:国际级|国家级|省部级|省级|市级|校级))")


def _number(text):
    whole, _, fraction = text.lstrip("+-").partition(".")
    whole = whole.lstrip("0") or "0"
    fraction = fraction.rstrip("0")
    value = f"{whole}.{fraction}" if fraction else whole
    return "-" + value if text.startswith("-") and value != "0" else value


def extract_presentation_highlights(kind, blocks) -> list[dict]:
    candidates = {}
    conflicts = set()
    award_context = False
    previous = None

    def record(block, highlight_type, label, raw_value, unit, *, level=None):
        value = _number(raw_value)
        if len(value) > 32:
            return
        key = (highlight_type, None if highlight_type == "award-total" else label)
        existing = candidates.get(key)
        if existing is None:
            candidates[key] = dict(type=highlight_type, label=label, value=value, unit=unit,
                                   level=level, sourceBlockId=block.blockId)
        elif (existing["value"], existing["unit"]) != (value, unit):
            conflicts.add(key)

    for block in blocks:
        if (previous is None or block.page != previous.page
                or block.readingOrder != previous.readingOrder + 1
                or block.bbox[1] < previous.bbox[1]
                or block.bbox[1] - previous.bbox[3] > max(
                    block.fontSize, previous.fontSize, previous.bbox[3] - previous.bbox[1])):
            award_context = False
        previous = block
        if getattr(block, "sourceType", None) == "ocr" and block.ocrConfidence < .8:
            award_context = False
            continue
        text = re.sub(r"[^\S\r\n]+", "", normalize("NFKC", block.text))
        for line in re.split(r"\r?\n", text):
            if not line:
                award_context = False
            for sentence in re.split(r"[。!?;]", line):
                clauses = re.split(r"[,、()]", _RESULT_PREFIX.sub("", sentence))
                if kind == "awards":
                    clauses = [part for clause in clauses for part in _AWARD_BREAKDOWN.split(clause)]
                uncertain_sentence = _UNCERTAIN.search(clauses[0])
                for clause in clauses:
                    if not clause:
                        continue
                    if uncertain_sentence or _UNCERTAIN.search(clause):
                        award_context = False
                        continue
                    if kind == "campusExperience":
                        metric = _CAMPUS.fullmatch(_PLATFORM_PREFIX.sub("", _RESULT_VERB.sub("", clause)))
                        if metric:
                            record(block, "campus-metric", *metric.groups())
                        continue
                    tally = _TOTAL.search(clause)
                    if tally and (not tally.start() or _TOTAL_PREFIX.fullmatch(clause[:tally.start()])):
                        category = next((group for group in tally.groups()[:4] if group), "")
                        record(block, "award-total", category + "奖项", tally[5], tally[6])
                        award_context = True
                        continue
                    tier = _TIER.fullmatch(clause)
                    award_context = bool(tier and (award_context or tier[3]
                                                   or clause.startswith(("共获", "累计获"))))
                    if award_context:
                        record(block, "award-tier", tier[1], tier[4], tier[5], level=tier[1])

    highlights = [candidate for key, candidate in candidates.items() if key not in conflicts]
    if kind == "awards":
        highlights.sort(key=lambda candidate: candidate["type"] != "award-total")
    return [
        DraftPresentationHighlight(id=f"source-highlight-{index}", origin="source",
                                   selected=False, **candidate).model_dump(exclude_none=True)
        for index, candidate in enumerate(highlights[:MAX_HIGHLIGHTS])
    ]
