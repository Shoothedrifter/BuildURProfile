"""Refresh reviewable v1 JSON contracts from the Python boundary models."""

import json
from pathlib import Path

from buildurprofile_agent.contracts import DesignConfigV1, GenerationBriefV1, DesignConfigV2, GenerationBriefV2, DesignConfigV3, GenerationBriefV3, DesignConfigV4, GenerationBriefV4, ResumeDraftV1


root = Path(__file__).resolve().parents[1] / "packages/contracts/schema"
root.mkdir(parents=True, exist_ok=True)
for name, model in (("generation-brief.v1.json", GenerationBriefV1),
                    ("design-config.v1.json", DesignConfigV1), ("generation-brief.v2.json", GenerationBriefV2), ("design-config.v2.json", DesignConfigV2),
                    ("generation-brief.v3.json", GenerationBriefV3), ("design-config.v3.json", DesignConfigV3),
                    ("generation-brief.v4.json", GenerationBriefV4), ("design-config.v4.json", DesignConfigV4),
                    ("resume-draft.v1.json", ResumeDraftV1)):
    (root / name).write_text(json.dumps(model.model_json_schema(), ensure_ascii=False,
                                       indent=2) + "\n")
