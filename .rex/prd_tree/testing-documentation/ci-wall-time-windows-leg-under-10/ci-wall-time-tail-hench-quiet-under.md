---
id: "244cbf2b-4043-4021-bcdb-c26daabb3424"
level: "task"
title: "CI wall-time tail: hench quiet under vitest, the prd.md fixture warning, and the last two spawn-per-test e2e files"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "A green hench or rex suite run prints no task briefs or turn headers, and a failing test still shows its console output"
  - "The prd.md-alongside-tree warning no longer fires during the test run"
  - "cli-smart-add.test.ts and cli-config.test.js run the CLI once per fixture state in beforeAll, with no drop in test count"
description: "Folds the open remainder of Layer 2 and Layer 5 into one item, audited against main on 2026-10-13. Done already: silent passed-only is set in all six vitest configs, and six of the eight named e2e files fold their CLI into beforeAll (tests/e2e/cli-ci.test.js, cli-init.test.js; rex cli-prd-bundle, cli-prune, cli-folder-tree; hench run-resolve, which lives at tests/integration/run-resolve.test.ts). Left to do, all three verified open: (1) hench has no quiet-under-vitest switch — nothing in packages/hench/src reads process.env.VITEST, so task briefs and turn headers still reach stdout from integration tests; (2) the prd.md-alongside-tree warning in packages/rex/src/store/file-adapter.ts still fires from a fixture that keeps both backends; (3) packages/rex/tests/e2e/cli-smart-add.test.ts (9 spawns, no beforeAll) and tests/e2e/cli-config.test.js (14 spawns, no beforeAll) still spawn per test. Layer 4 landed separately in PR #697 as tests/vitest-isolation.mjs."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-13T22:18:36.479Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
