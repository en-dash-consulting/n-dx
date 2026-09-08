---
"@n-dx/core": patch
---

Give every workflow skill an explicit stopping condition, and stop exempting the
repo-local skills from the portability guards.

A skill without a stated ending does not fail loudly — it overruns. The agent
finishes what was asked, still holds context and tools, and continues into
whatever looks adjacent: fixing the defect it was only asked to report,
committing files it was only asked to inspect. Twelve of the thirteen skills
ended on their last action with nothing marking it as the last;
`ndx-adversarial-review` was the only one that said where it stopped. Each skill
now closes with a `## Done when` section naming both the terminating action and
what is deliberately out of scope, enforced by `skill-termination.test.js`.

`skill-portability.test.js` derived its skill list from the assistant-assets
manifest, so `iso-map`, `triage` and `dev-link` — which exist only in
`.claude/skills/` — were checked by none of its guards. The suite passed anyway,
so the gap was invisible. Both suites now enumerate through
`tests/helpers/all-skills.js`, which covers manifest and repo-local skills alike
and derives the local set by subtraction, so a new skill of either kind is
covered as soon as it appears. The three were already portable; the guard simply
did not know they existed.

The prompt census now measures skill bodies (`--json`, `--compare`, and a table
in the recorded baseline). A skill body enters context whole on invocation, so
its size is a per-invocation bill in the same way a builder's fixed text is a
per-call one — and it was the one category of prompt text edited by hand most
often with no number attached. Recorded at 16,990 tokens across 13 skills, of
which `ndx-adversarial-review` is 5,167. Skill totals are reported separately
from per-call totals, never summed: a skill run and an analyze call are
different events.
