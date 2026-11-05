import json
from pathlib import Path

from buildurprofile_agent.contracts import DesignConfigV1, GenerationBriefV1


ROOT = Path(__file__).resolve().parents[3] / "packages/contracts/schema"


def test_checked_in_json_contracts_match_python_boundary():
    for filename, model in (("generation-brief.v1.json", GenerationBriefV1),
                            ("design-config.v1.json", DesignConfigV1)):
        assert json.loads((ROOT / filename).read_text()) == model.model_json_schema()
