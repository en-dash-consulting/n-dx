---
id: "a96f0d51-dc84-4c5b-9ab8-ad3c508b6334"
level: "task"
title: "`ndx ci` architecture-policy step always fails: ci.js child_process allowlist has drifted from the e2e test's"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-10-07T03:45:02.602Z"
completedAt: "2026-10-07T03:58:11.658Z"
endedAt: "2026-10-07T03:58:11.658Z"
resolutionType: "code-change"
resolutionDetail: "ci.js and architecture-policy.test.js both read packages/core/child-process-allowlist.json; a parity test compares ci.js checkArchitecturePolicy against the test's scan."
acceptanceCriteria:
  - "`ndx ci .` on this repository passes its architecture-policy step (today it lists 26 violations)"
  - "ci.js and tests/e2e/architecture-policy.test.js read the child_process allowlist from one shared definition"
  - "A test fails if a file allowed by one enforcement point is rejected by the other"
description: "Verdict: out-of-scope (pre-existing, found during the adversarial review of d31d9aa8). Severity medium.\n\nFailure: `ndx ci .` on this repository reports `CI pipeline failed.` because its \"architecture policy\" step lists 26 files importing node:child_process (core's bin/*.js, cli.js, web.js, win-spawn.js, mcp-shim.js, llm-client process-tree.ts, several scripts/*.mjs, and more). `tests/e2e/architecture-policy.test.js` enforces the same rule and passes, because it keeps its own, larger allowlist. `packages/core/ci.js` carries a separate 17-entry `CHILD_PROCESS_ALLOWED` that nobody has kept in step. One constraint with two enforcement points and two lists: the drift ENFORCEMENT.md is meant to prevent.\n\nEvidence: packages/core/ci.js:972 (`CHILD_PROCESS_ALLOWED`), checkArchitecturePolicy at ci.js:1011. Verified identical (26 violations) before and after d31d9aa8, so that change did not cause it.\n\nReachable: CONTRIBUTING.md step 5 tells contributors to run `ndx ci .` before pushing. It always fails, which teaches people to ignore the gate. CI does not run it (ci.yml uses `pnpm pr-check`), which is why the drift went unnoticed.\n\nOptions:\n1. (Recommended) Single source of truth: move the allowlist into a shared JSON (as `gateway-rules.json` already does for gateway imports) read by both ci.js and the e2e test. Cost: small; removes the class.\n2. Remove the duplicate check from ci.js and rely on the e2e test. Cost: smallest. Risk: `ndx ci` stops enforcing it for downstream projects.\n3. Copy the test's list into ci.js. Cheapest today, drifts again."
lastModified: "2026-10-07T03:58:11.874Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
