---
id: "7cad623b-8b71-422a-a179-8da5f5025142"
level: "task"
title: "Make the affected gate's stale-build check content-aware so partial and no-emit builds are judged correctly"
status: "completed"
priority: "medium"
startedAt: "2026-10-08T16:56:00.640Z"
completedAt: "2026-10-08T17:05:24.464Z"
endedAt: "2026-10-08T17:05:24.464Z"
acceptanceCriteria:
  - "After a partial build that refreshes only some of a changed package's dist (e.g. web build:landing after a server source edit), the affected gate still reports that package stale (test)"
  - "After a full build, rewriting a built source with identical content and running a successful no-emit incremental build lets the affected gate pass (test)"
  - "An edit to a changed package's source without a build still fails the gate naming the package and its build command, and --list still skips the check"
  - "TESTING.md describes how freshness is judged"
description: "From the PR #588 review (ryrykeith, 2026-10-08), on task e03605a0. Two should-fix findings, both reproduced by the reviewer. The new affected-gate check uses one mtime heuristic (scripts/lib/stale-dist.mjs staleSeconds: newest file anywhere in dist/ vs newest source in src/), and it is now fatal rather than a warning.\n\n1. A partial build hides stale compiled code (scripts/lib/stale-dist.mjs:61). Edit packages/web/src/server/…, then run `pnpm --filter @n-dx/web build:landing` (build.js --landing-only). That refreshes dist/landing/index.html without compiling the server, so staleChangedPackages returns [] and the gate runs dist-reading tests (e.g. the effective-agent-config contract) against the old server output.\n2. A successful incremental rebuild cannot clear the failure (scripts/run-all-tests.mjs:235). sourcevision builds with plain `tsc` and incremental: true. Touch or rewrite a built source with identical content (checkout, restore): its mtime is now newer than dist/, but tsc skips emitting unchanged outputs and exits 0 without touching dist/, so `affected <base>` exits 1 forever asking for a build that already happened.\n\nRecommended fix: content-aware freshness recorded by a completed full build. Each package build that produces dist/ writes a stamp (e.g. dist/.build-stamp.json) only after its full build succeeds, holding a hash of the source content the build compiled; the gate recomputes that hash for each changed package and treats the package as stale when the stamp is missing or the hash differs. A partial build (build:landing) never writes the stamp; a no-emit incremental tsc run still rewrites it. Keep the gate scoped to packages the change touched, keep --list skipping the check, and share the logic with tests/e2e/verify-build.js as today. If a stamp per package is not workable, say why in the summary and choose the smallest content-aware alternative.\n\nThe hench sandbox pre-approves only npm, npx, node, git, tsc and vitest commands; use those forms (e.g. `npm run build --prefix packages/<pkg>`), never pnpm."
lastModified: "2026-10-08T17:05:24.732Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
