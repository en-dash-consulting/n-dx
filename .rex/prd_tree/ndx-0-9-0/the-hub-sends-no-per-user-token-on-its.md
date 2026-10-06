---
id: "f2116b57-582f-4747-8b86-3f65fd5da1ac"
level: "task"
title: "The hub sends no per-user token on its own calls to project servers, so queued runs and the session cap fail with auth on"
status: "pending"
priority: "high"
tags:
  - "0.9.0"
  - "hub"
  - "web-server"
  - "auth"
  - "security"
source: "review"
acceptanceCriteria:
  - "With auth enabled, a run queued by the hub starts when admitted (integration test with a real hub and child)."
  - "With auth enabled, countProjectExecutions reports a running dashboard execution, so the session cap holds (test)."
  - "With auth enabled, POST /api/hench/execute/check from the hub returns a verdict rather than 401 (test)."
  - "No hub-to-project fetch in packages/web/src/hub goes out without the token when the hub has one."
description: "Since #489 every request to a project server must present the per-user token (X-Ndx-Token, Authorization: Bearer, or the ndx_token cookie) unless auth is off (`--no-auth` / `web.auth: false`); packages/web/src/server/request-security.ts enforceToken answers 401 otherwise, with no exemption for the hub.\n\nThe hub authenticates two of its own calls to project servers — the health probe (packages/web/src/hub/children.ts checkProjectHealth) and the overview fan-out (packages/web/src/hub/overview.ts fetchChildSnapshot) both send `X-Ndx-Token: hub.token` — but not the other two:\n- `postExecute` in packages/web/src/hub/hub.ts (~line 157), used by startQueuedExecution (the queued-run replay) and validateQueuedExecution (`POST /api/hench/execute/check`, the pre-queue check). With auth on, a queued run is refused 401 at its turn and recorded as dropped (\"could not start\"); the pre-check gets 401, reads it as no verdict and fails open.\n- `countProjectExecutions` in packages/web/src/hub/admission.ts (~line 491), the in-flight count behind the machine-wide session cap. With auth on it gets 401 and counts 0, so the cap never holds.\n\nBrowser-originated execute requests are unaffected (the proxy forwards the browser's cookie), which is why the dashboard looks fine until the machine is busy enough to queue.\n\nFix (recommended): pass `hub.token` to both — postExecute sends `X-Ndx-Token` like checkProjectHealth does, and countProjectExecutions takes a `token` parameter (its caller in hub.ts ~283 passes `this.token`). Add an integration test that runs the hub and a child with auth enabled and asserts a queued run starts at its turn and the count reflects a running execution. Grep packages/web/src/hub for any other `fetch(` to a child that lacks the header. Related, from the 0.8.0 release audit (D3): `ndx refresh`'s reload request also sends no token — check whether the same helper should cover it. Patch changeset for @n-dx/web.\n\n## How to run checks without approval prompts (operator note)\n\nCommands are only pre-approved when they START with `npx`, `node`, `npm`, `git` or `vitest`; never prefix one with `cd … &&`. From the project root: `npx vitest run --root packages/<pkg> [paths]`, `npx tsc -p packages/<pkg>/tsconfig.json --noEmit` (web also `-p packages/web/tsconfig.test.json`), and `npx vitest run tests/e2e tests/integration` for the root policy tests. e2e tests that spawn a CLI need that package's dist rebuilt: `npm run build --prefix packages/<pkg>`. Run a final check with `env -u NDX_CLI_PATH -u N_DX_CLI_PATH` cleared is not possible in the sandbox; note in the summary if a test depends on the environment."
lastModified: "2026-10-05T17:18:11.613Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
