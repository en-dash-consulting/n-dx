---
id: "848a8d37-004b-4751-a8cd-234f0cf15027"
level: "task"
title: "web's assertFreshServerBuild still judges freshness by mtime, so a partial build masks a stale server and an identical rewrite fails forever"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "assertFreshServerBuild throws when web src changed after a full build even though a later partial build (build:landing) wrote newer files into dist/ (test)"
  - "assertFreshServerBuild passes when a built source was rewritten with identical content and no new output was emitted (test)"
description: "Source: adversarial review of task 7cad623b (content-aware stale-build stamp). Verdict: out-of-scope (pre-existing; that task moved the root gate and tests/e2e/verify-build.js to the stamp but not this helper).\n\nFailure: packages/web/tests/helpers/built-server-guard.ts:102-104 compares newest src mtime against newest file anywhere in dist/ — the same heuristic the PR #588 review rejected.\n- Edit packages/web/src/server/…, run `pnpm --filter @n-dx/web build:landing` → dist/landing/index.html is newer than the edit, the guard passes, and port-zero-reporting / scoped-route-dispatch boot the OLD compiled server.\n- Rewrite a built web source with identical content (git checkout/restore) → incremental tsc emits nothing, src mtime stays newer than dist, the guard throws \"Stale build output\" after a successful build.\n\nReachable: the web package suite (run by the affected gate whenever web changes).\n\nOptions:\n1. (recommended) Replace the mtime body with `isBuildCurrent(srcDir, distDir)` from scripts/lib/stale-dist.mjs (the web build now writes dist/.build-stamp.json last). Cost: small; the helper's unit tests must switch from utimes to stamps. Risk: the helper imports a root script from a package test — check the web boundary/import policy tests, or copy the 20-line check.\n2. Leave as is; accept the mtime gaps in the web suite."
lastModified: "2026-10-08T16:58:50.972Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
