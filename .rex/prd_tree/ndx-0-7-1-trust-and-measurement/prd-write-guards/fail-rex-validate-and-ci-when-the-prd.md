---
id: "a2055192-ee33-40b7-b8a7-bb459b96828d"
level: "task"
title: "Fail rex validate and CI when the PRD tree does not match the slug rule"
status: "completed"
priority: "high"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "wm-2080"
source: "caos work management: WM2080 (Fail rex validate and CI when the PRD tree does not match the slug rule); guards PR, front of 0.7.1 wave 1"
startedAt: "2026-09-21T19:16:12.854Z"
completedAt: "2026-09-21T21:47:50.065Z"
endedAt: "2026-09-21T21:47:50.065Z"
acceptanceCriteria:
  - "rex validate exits 1 on a fixture tree containing one re-suffixed path, prints the offending paths and names rex migrate-slugs as the fix; on a conformant tree it exits 0 with no slug output."
  - "The CI PR check fails on a branch that carries a non-conformant path (demonstrated once with a throwaway branch and recorded in the PR)."
  - "tests/e2e/prd-slug-conformance.test.js exists, asserts the repository tree is conformant, and passes on main."
  - "The other validate warnings (blocked-without, timestamp, parent-child) keep their warning severity."
description: "rex validate already detects paths that do not match the current slug rule (the 'tree slug convention' check in packages/rex/src/cli/commands/validate.ts, backed by findNonConformingSlugs), but it reports them at warning severity and exits 0. The CI PR check in .github/workflows/ci.yml runs rex validate and therefore passed a pull request that renamed 1,570 files to an older rule. Promote the slug convention check to an error: a non-conformant tree means the next write will rewrite it, so it is not a warning. Keep the other structural warnings as warnings. Add an end-to-end test that asserts this repository's own tree is conformant so pnpm test catches it locally as well as in CI.\n\nImplementation notes: In packages/rex/src/cli/commands/validate.ts change the 'tree slug convention' check (around line 269, fed by findNonConformingSlugs) from severity 'warn' to 'error' so it drives exit code 1, and make its message list the offending paths and end with 'run rex migrate-slugs on the default branch'. Confirm the CI PR check step in .github/workflows/ci.yml still runs rex validate against the checkout so the new severity fails the job. Add tests/e2e/prd-slug-conformance.test.js that loads the repository's .rex/prd_tree through the rex parser and asserts findNonConformingSlugs returns an empty list; add a unit case in packages/rex/tests/integration/slug-conformance-check.test.ts for the error exit. Verify on a throwaway branch that renames one PRD file to an id-suffixed name that CI goes red, then delete the branch. Changeset: @n-dx/rex patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T21:47:50.405Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
