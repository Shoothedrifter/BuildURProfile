"""Inject only user-confirmed resume content into the mapped design."""

import copy
import re

from ..contracts import clean_config


def short_labels(skills: list[str]) -> list[str]:
    return [match.group(1).strip() for item in skills
            if (match := re.match(r"^([^\n：:]{1,24})\s*[:：]", item))]


def compose_resume(inputs: dict, _: dict) -> dict:
    # The mapper uses an empty placeholder; validate after confirmed content is set.
    config = copy.deepcopy(inputs["config"])
    content = inputs["content"]
    if "sourceRefs" in content:
        raise ValueError("PDF excerpts cannot enter graph state")
    config["content"] = content
    config["marquee"]["items"] = short_labels(content["expertise"]["skills"])
    return {"config": clean_config(config)}


def compose_resume_v3(inputs: dict, _: dict) -> dict:
    from ..contracts import DesignConfigV2
    config = copy.deepcopy(inputs['config'])
    config['content'] = copy.deepcopy(inputs['content'])
    config['marquee']['items'] = short_labels(config['content']['expertise']['skills'])
    return {'config': DesignConfigV2.model_validate(config).model_dump(exclude_none=True)}


def compose_resume_v4(inputs: dict, _: dict) -> dict:
    from ..contracts import DesignConfigV3
    config = copy.deepcopy(inputs['config'])
    config['content'] = copy.deepcopy(inputs['content'])
    config['marquee']['items'] = short_labels(config['content']['expertise']['skills'])
    return {'config': DesignConfigV3.model_validate(config).model_dump(exclude_none=True)}
