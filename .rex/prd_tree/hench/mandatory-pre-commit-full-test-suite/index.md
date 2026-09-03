---
id: "dde6d1c4-a1bd-4dfe-9af8-0ec057addf16"
level: "feature"
title: "Mandatory Pre-Commit Full Test Suite Gate"
status: "pending"
source: "smart-add"
startedAt: "2026-04-30T16:08:35.689Z"
endedAt: "2026-04-30T16:08:35.689Z"
acceptanceCriteria: []
description: "Introduce a distinct, mandatory step in the hench run lifecycle that executes the project's entire test suite before allowing a commit, regardless of whether failing tests are related to the current task. The gate is only bypassable via an explicit opt-out flag, and prompts the user when the test command is unknown or inaccessible."
lastModified: "2026-09-03T14:02:17.631Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add distinct full-test-suite gate step to hench run lifecycle before commit](./add-distinct-full-test-suite-gate-step.md) | completed |
| [Replace rex's wall-clock scaling assertion — it fails the gate under agent CPU load](./replace-rex-s-wall-clock-scaling.md) | completed |
| [Resolve test command via project config with interactive prompt fallback for unknown or inaccessible suites](./resolve-test-command-via-project.md) | completed |
| [Test gate must not fail a run for a suite it never executed](./test-gate-must-not-fail-a-run-for-a.md) | pending |
| [Test gate must surface real failure output when the runner is not vitest --reporter=json](./test-gate-must-surface-real-failure.md) | pending |
