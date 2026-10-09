---
id: "7d3e9741-f0e1-4c21-9bfe-4ddd7aec7a4d"
level: "task"
title: "Hench rebuilds the packages a run changed before the affected test gate"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "test-gate"
  - "stale-dist"
source: "run-verification"
acceptanceCriteria:
  - "Before the affected gate, hench builds each package whose src/ the run changed (pnpm --filter <name> build) and records the build in the run record (test)"
  - "The build runs after review repairs are committed, so a repair that edits package source is built before the gate (test)"
  - "A gate-only retry builds the changed packages before re-running the gate (test)"
  - "A build failure fails the run with the build output, not as a stale-dist gate failure (test)"
  - "A run that changes no package source builds nothing (test)"
  - "The brief no longer needs to tell the agent to rebuild before finishing"
description: "Since #588 the affected gate (scripts/run-all-tests.mjs affected, content stamp from 7cad623b) refuses to run when a package the change edited under src/ has a dist/ that is not a full build of it (test-gate: stale-dist=<dirs>). Hench builds nothing before the gate, so a run whose committed work is correct still fails. Two triggers seen on 2026-10-08:\n\n1. The agent never builds. Run 699cd138 (task b32a3e6f, PR 13): the agent ran rex unit tests, typecheck and the root policy tests but not pnpm build. Rebuilding rex and re-running the same gate passed 5/5 suites.\n2. The in-run review repairs source after the agent built. Run d3e891fe (task 000328e7, PR 31): the agent built rex and committed 034fecbb0; the reviewer's repair 66426a641 then edited packages/rex/src/store/prd-model-transaction.ts, and the gate found rex stale. The gate-only retry (run cb58facb, #539 item 1) also builds nothing, so it failed identically in 1s and spent the task's second attempt.\n\nReach: every run that edits a package's source. Fails safe (stale code never passes), but the run fails and needs a manual rebuild and rerun.\n\nFix: immediately before the gate, after review repairs are committed and on a gate-only retry, build each package whose src/ the run changed, picking them with staleChangedPackages from scripts/lib/stale-dist.mjs. Workaround until fixed: rebuild the package, then rerun the same ndx work --task=<id>; the gate-only retry applies the held completion on green. Until then the PR 17 tasks carry a saved contextNotes rebuild line; remove it once this lands.\n\nSupersedes 7d415177, captured for the same bug on the PR 13 branch and moved out there so main gets one item."
lastModified: "2026-10-08T21:43:55.184Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
