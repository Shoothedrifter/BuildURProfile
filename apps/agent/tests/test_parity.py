"""Prevent the browser preview and Python Agent from drifting on score/design rules."""

import json
from pathlib import Path
import subprocess

from buildurprofile_agent.skills.assessment import score_answers
from buildurprofile_agent.skills.design import style_to_config


ROOT = Path(__file__).resolve().parents[3]


def test_browser_python_score_and_mapping_parity():
    script = """
      import { scoreAnswers } from './packages/skills/src/assessment.ts';
      import { styleToConfig } from './packages/skills/src/mapping.ts';
      const roles = ['ui-ux-designer', 'frontend-creative-developer', 'brand-motion-copy'];
      const cases = [];
      for (const role of roles) for (let tone = 0; tone < 4; tone++) for (let level = 0; level < 5; level++) {
        const answers = Object.fromEntries(['e-presence','e-type','k-pace','k-cards','p-tone',
          'p-strength','s-browse','s-control'].map(id => [id, id === 'p-tone' ? tone : level]));
        const vector = scoreAnswers(answers);
        cases.push({role, answers, vector, config: styleToConfig(vector, role)});
      }
      process.stdout.write(JSON.stringify(cases));
    """
    result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT,
                            capture_output=True, text=True, check=True)
    cases = json.loads(result.stdout)
    assert len(cases) == 60
    for case in cases:
        vector = score_answers(case["answers"])
        assert vector == case["vector"]
        assert style_to_config(vector, case["role"]) == case["config"]
