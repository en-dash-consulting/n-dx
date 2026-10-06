---
id: "84089526-8e87-4c0d-a738-d12d07b317f8"
level: "task"
title: "The dashboard's LoE pass-through in Smart Add, batch import and the proposal editor has no test, so dropping it would go unnoticed"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
  - "viewer"
  - "r0"
  - "task-prep"
  - "0.9.0"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "smart-add-input.test.ts asserts the accept-edited body carries loe, loeRationale and loeConfidence from the proposal"
  - "batch-import-panel.test.ts asserts the same for batch import"
  - "proposal-editor.test.ts asserts the same, including after the task title is edited"
  - "Each new assertion fails when the corresponding viewer pass-through line is removed"
description: "**This task is part of PR 1 of 4** (Prepare task phase 2, R0). Found by /ndx-adversarial-review of origin/main...feat/090-r0-loe-fidelity. Verdict: should-fix (severity medium: a test that does not protect the behaviour the PR adds).\n\n## Failure scenario\nPR 1 made three viewer components carry `loe`, `loeRationale` and `loeConfidence` from each proposal task into the `POST /api/rex/proposals/accept-edited` body:\n- packages/web/src/viewer/components/prd-tree/smart-add-input.ts:234-236\n- packages/web/src/viewer/components/prd-tree/batch-import-panel.ts:237-239\n- packages/web/src/viewer/components/prd-tree/proposal-editor.ts:117-119 (toEditable) and :322-324 (the accept payload)\n\nDelete any of those lines and every test still passes: the server route test (packages/web/tests/unit/server/routes-rex.test.ts, \"keeps valid LoE fields and drops invalid ones\") posts the body directly, and the existing viewer tests (packages/web/tests/unit/viewer/smart-add-input.test.ts, batch-import-panel.test.ts, proposal-editor.test.ts) never assert the accept-edited request body. A dashboard user accepting Smart Add or batch-import proposals would then silently lose the LoE data again, which is the exact regression R0 exists to stop.\n\n## Reachability\nReal: the dashboard's Smart Add bar, batch import panel and proposal editor all post accept-edited. `rex add --format=json` (spawned by `/api/rex/smart-add-preview` and batch import) already emits the three fields after PR 1 (smart-add-duplicates.ts `attachDuplicateReasonsToProposals`).\n\n## Proposed solution (recommended)\nIn each of the three viewer test files, feed a proposal whose task carries `loe: 1.5, loeRationale: \"…\", loeConfidence: \"medium\"`, trigger accept, capture the fetch to `/api/rex/proposals/accept-edited` (the files already stub fetch), and assert the posted task carries the three fields unchanged. For proposal-editor also assert that editing the task's title does not drop them. Cost: three small tests; no production change. Check each test fails with its viewer line removed.\n\n## Operator note\nCommands are pre-approved only when they START with npx, node, npm, git or vitest. Never prefix a command with `cd … &&`. From the project root, run:\n- `npx vitest run --root packages/<pkg> [paths]` for tests;\n- `npx tsc -p packages/<pkg>/tsconfig.json --noEmit` to typecheck (if npx cannot find tsc from the root, use `npm run typecheck --prefix packages/<pkg>`);\n- `npx vitest run tests/e2e tests/integration` for the root policy tests (gateway export caps, contract lists, wall-clock inventory).\ne2e tests that spawn a CLI need `npm run build --prefix packages/<pkg>` first. Add a patch changeset for each package, using its scoped name, only if non-test code changes."
lastModified: "2026-10-06T01:22:10.566Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
