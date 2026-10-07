---
id: "23ac07f7-5dc3-48c2-8310-1de6beba5943"
level: "task"
title: "`node packages/core/ci.js .` is a silent no-op, yet `pnpm verify` and CONTRIBUTING.md run the CI gate that way"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-10-07T04:14:27.343Z"
acceptanceCriteria:
  - "`pnpm verify` actually executes the CI pipeline (a deliberately introduced CI violation makes it exit non-zero)"
  - "No documentation or script invokes `node packages/core/ci.js` expecting it to run checks"
  - "A test fails if the verify script's CI step completes without running any CI phase"
description: "Verdict: out-of-scope (pre-existing, found during the adversarial review of d31d9aa8). Severity medium.\n\nFailure: `packages/core/ci.js` is a library module. It exports `runCI` and has no main entry, so `node packages/core/ci.js .` exits 0 without printing anything or checking anything. The root `package.json` `verify` script ends with `node packages/core/ci.js .`, so `pnpm verify` reports green for a gate that never ran. CONTRIBUTING.md's CI references describe the same invocation. The real gate runs only through `ndx ci .` (cli.js → runCI).\n\nEvidence: package.json scripts.verify; packages/core/ci.js (no `import.meta.url === pathToFileURL(process.argv[1])` guard, no top-level call). Reproduced with exit code 0 and empty output.\n\nReachable: anyone running `pnpm verify` gets a false pass.\n\nOptions:\n1. (Recommended) Change `verify` to `node packages/core/cli.js ci .` and correct CONTRIBUTING.md. Cost: trivial. Note the companion item: that gate currently fails on the allowlist drift, so fix that one first or `verify` turns red.\n2. Add a main-module guard to ci.js so direct invocation runs runCI. Risk: a second entry point to maintain."
lastModified: "2026-10-07T15:03:59.065Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
