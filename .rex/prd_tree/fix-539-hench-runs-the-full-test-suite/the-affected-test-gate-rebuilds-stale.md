---
id: "7d415177-7a90-4035-9841-807ddf29bada"
level: "task"
title: "The affected test gate rebuilds stale packages instead of failing"
status: "pending"
priority: "high"
acceptanceCriteria:
  - "In affected mode, when staleChangedPackages names packages, run-all-tests.mjs builds exactly those packages in one pnpm invocation (pnpm --filter <name> per package, so pnpm orders them by dependency), then checks the build stamps again before running any suite; the output names each rebuilt package (test)"
  - "A build that fails, or a package still stale after its build, fails the gate with exit 1, the package named and the build's output, and still prints test-gate: stale-dist=<dirs> so callers that read it keep working (test)"
  - "A change whose packages all have current build stamps builds nothing, and --list mode never builds (test)"
  - "It never runs a full pnpm build or builds a package the stale check did not name (test)"
  - "The e2e globalSetup check (tests/e2e/verify-build.js) is unchanged: a stale build still fails it outside the gate"
  - ".rex/workflow.md says the affected gate rebuilds stale packages itself, and no longer needs tasks to carry a rebuild reminder; the agent still builds what it changed before running root e2e tests itself"
description: "Since #588 the affected gate (scripts/run-all-tests.mjs affected <base>) refuses to run when a package whose src/ the change edited has a dist/ that is not a full build of that source (staleChangedPackages in scripts/lib/stale-dist.mjs compares a source hash with dist/.build-stamp.json). It prints test-gate: stale-dist=<dirs> and exits 1. Hench runs fail this way whenever source is edited after the last build: the agent skips the rebuild (despite .rex/workflow.md), the in-run reviewer's repair edits source after the agent built, or a gate-only retry runs the gate without building. Runs 699cd138 (PR 13) and the PR 17 store-transaction run failed with correct committed work; sessions now add rebuild notes to every task description by hand.\n\nFix it in the gate, not in hench. The gate already knows exactly which packages are stale; it builds them and carries on. That covers every trigger at once (agent, review repair, gate-only retry, a person running the gate), needs no hench change and no runner update, because the gate script is the tested repository's own, and reaches any branch as soon as it merges main. Tests still never run against a stale build, which is what #588 protects.\n\nDecided 2026-10-09 (Ryan): its own fix PR from main; originally captured on the PR 13 branch as a hench change."
lastModified: "2026-10-09T04:55:07.831Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
