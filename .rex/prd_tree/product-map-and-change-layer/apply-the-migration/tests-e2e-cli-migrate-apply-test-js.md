---
id: "aa61a436-8c23-463a-b895-8eb64dee9484"
level: "task"
title: "tests/e2e/cli-migrate-apply.test.js fails 3 of 5: its fixture keeps .rex/prd.json, which apply now refuses"
status: "in_progress"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "pr-23"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-12T09:52:58.815Z"
acceptanceCriteria:
  - "node_modules/.bin/vitest run tests/e2e/cli-migrate-apply.test.js passes all cases after building rex"
  - "An e2e case asserts ndx migrate --apply refuses, exits non-zero and writes nothing while .rex/prd.json sits beside the tree"
  - "After rex migrate-to-folder-tree converts .rex/prd.json, rex migrate --apply proceeds on that project (test)"
description: "Found by the adversarial review of 3e5c1961 (run 018cd834). Verdict: out-of-scope for that change. The defect was introduced earlier on this branch by 4552ffc7b (task a09e2a27, the legacy-source refusal), not by the dry-run rehearsal.\n\nFailure: the e2e fixture runs setupRexDir (writes .rex/prd.json), then `rex migrate-to-folder-tree`, then `ndx migrate --plan`. migrate-to-folder-tree leaves prd.json with no prd.json.migrated marker. So `ndx migrate --apply [--dry-run]` now refuses with \"Legacy PRD source beside the tree: …/.rex/prd.json\". The dry-run, `--plan <path>` and real-apply cases fail; only the missing-plan and no-flag cases pass. This was reproduced locally after `pnpm --filter @n-dx/rex build`: `node_modules/.bin/vitest run tests/e2e/cli-migrate-apply.test.js` gives 3 failed / 2 passed. CI runs this file, so the branch's PR is red.\n\nOptions:\n(a) Recommended. In the fixture's beforeEach, remove .rex/prd.json after migrate-to-folder-tree, since a real project reaching apply has no legacy source, and add one e2e case asserting the refusal through ndx with exit non-zero. Cheap; keeps the refusal's contract.\n(b) Have migrate-to-folder-tree write the prd.json.migrated marker (or remove prd.json) so its output is apply-ready. More correct for users who just ran it, but it touches a command 2ea252fe removes; decide whether it is worth it before 1.0.0.\n\nAdded overnight 2026-10-12 (confirm): the same sequence is the real path for a prd.json project. `rex migrate-to-folder-tree` (and the chain's prd-tree step in C3) leaves .rex/prd.json with no prd.json.migrated marker, so `ndx migrate` would then refuse at apply. Fix it at the source: the folder-tree conversion writes the marker (or the existing equivalent) when it converts prd.json, so apply's legacy-source refusal only fires for a prd.json nobody migrated. Then the e2e fixture passes without special-casing, and the refusal case keeps its own test."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T09:52:59.091Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
