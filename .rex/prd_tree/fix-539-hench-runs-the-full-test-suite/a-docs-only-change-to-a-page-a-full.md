---
id: "7b0b3d72-d77b-414c-9729-527c18edf8ef"
level: "task"
title: "a docs-only change to a page a full-root test validates (README.md, docs/guide/*.md, docs/cli-ui-gap.md) selects no suite"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "selectAffected(['README.md']) selects a suite that runs tests/e2e/command-docs-parity.test.js, pinned by a unit test"
  - "selectAffected(['docs/guide/workflow.md']) selects a suite that runs tests/e2e/docs-skill-refs.test.js, pinned by a unit test"
  - "selectAffected(['docs/cli-ui-gap.md']) selects a suite that runs tests/e2e/cli-ui-gap-drift.test.js, pinned by a unit test"
  - "selectAffected(['docs/guide/skills.md']) still selects nothing"
  - "TESTING.md's 'Not yet covered' note is removed or updated to match"
description: "Found by the adversarial review of task e51ab955 (F2 fix). Verdict: should-fix — same defect class as F2, pre-existing, not covered by that task's scope (which named only the root-subset artifacts).\n\nFailure: the Markdown/docs short-circuit in scripts/lib/select-suites.mjs selectAffected (`if (isMarkdown(file) || file.startsWith(\"docs/\")) continue;`) still drops docs that root tests parse, because VALIDATED_ARTIFACTS only maps artifacts whose test runs in root-policy/root-drift. Examples, each selecting [] today:\n- README.md or docs/guide/commands.md alone → tests/e2e/command-docs-parity.test.js (asserts every command is documented in both) never runs.\n- docs/guide/workflow.md with its ./skills link removed → tests/e2e/docs-skill-refs.test.js fails in CI, gate green. (docs/guide/skills.md is excluded by that test, so it is correctly prose.)\n- docs/cli-ui-gap.md → tests/e2e/cli-ui-gap-drift.test.js.\n- docs/guide/troubleshooting.md / README.md → tests/e2e/assistant-parity-smoke.test.js (check exact assertion).\nReachable via hench's scoped gate (`run-all-tests.mjs affected {base}`) on any docs-only task. CI catches it after the run.\n\nOptions:\nA (recommended) — new root subset `root-docs` holding the docs-validating tests (command-docs-parity, docs-skill-refs, cli-ui-gap-drift, maybe assistant-parity-smoke if cheap); map README.md, docs/guide/*.md except skills.md, docs/cli-ui-gap.md to it via VALIDATED_ARTIFACTS (extend to support a prefix/predicate entry). Measure cost first, as F1 did; cost: small, keeps docs edits off full root.\nB — map these files to full root. Simple, but every guide edit pays 2.5–6 min.\nC — accept and document (already documented in TESTING.md as \"Not yet covered\").\nDecision for the owner: whether docs edits should ever run tests at the gate."
lastModified: "2026-10-07T16:43:27.162Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
