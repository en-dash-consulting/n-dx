---
id: "856e89fb-302f-4079-941f-a623bf591a31"
level: "task"
title: "Stale node_modules makes `pnpm typecheck` report type errors that CI does not have"
status: "completed"
priority: "medium"
tags:
  - "tooling"
  - "developer-experience"
  - "dependencies"
source: "ndx-capture"
startedAt: "2026-08-25T19:32:04.388Z"
completedAt: "2026-08-25T19:38:31.045Z"
endedAt: "2026-08-25T19:38:31.045Z"
acceptanceCriteria:
  - "A documented command reports any workspace dependency whose installed version does not satisfy the range declared in its package.json"
  - "Given a tree where typescript resolves to 5.9.3 while package.json declares ^6.0.3, the check names the package, the declared range, and the installed version"
  - "The check covers every dependency in every workspace package.json, not only typescript"
  - "The check is reachable from the project's documented validation path, so a contributor or agent sees it before concluding that a red `pnpm typecheck` is a real type error"
  - "A test covers the drift case using a fixture where the installed and declared versions disagree"
  - "The check passes silently on a correctly-installed tree and adds no measurable time to `pnpm typecheck`"
description: "All five workspace packages declare `typescript: ^6.0.3`, but nothing verifies that the installed version actually satisfies the declared range. A tree whose `node_modules` predates a dependency bump silently produces type errors from the older `lib.dom.d.ts`, and there is no signal distinguishing those from real type errors.\n\nFAILURE SCENARIO (observed 2026-08-24): `pnpm typecheck` failed on `packages/web/tests/unit/landing/landing.test.ts` — `scrollMargin` does not exist on `IntersectionObserver` — while `packages/web/node_modules/typescript` resolved to 5.9.3 against a declared `^6.0.3`. GitHub check-runs for main's tip `cfdd3b5d` show Build & Validate green; that job runs `pnpm typecheck` at `.github/workflows/ci.yml:71` with the identical file present. The failure was therefore entirely local, caused by a stale install rather than by any defect in the code.\n\nIMPACT: this is not hypothetical. During the merge-conflict review of `81d54c79` it produced a wrong recommendation — that a correct test needed fixing to unblock CI. A contributor acting on that would have deleted a valid `scrollMargin` assertion from a correct test to satisfy a compiler that should not have been running. It misleads AI agents and humans identically, because both read a red typecheck as evidence of a real defect.\n\nREACHABILITY: any local run of `pnpm typecheck`, and any agent or skill that treats a red typecheck as ground truth. Not caught upstream — nothing in the repo compares resolved versions against declared ranges.\n\nSCOPE: check every workspace dependency, not just TypeScript. Same implementation cost, and it catches the whole class rather than the one instance that happened to surface first.\n\nSOLUTION OPTIONS:\n(a) RECOMMENDED — a `preinstall` or `doctor`-style check that walks each workspace `package.json`, compares every declared range against the resolved version in `node_modules`, and reports mismatches by package, declared range, and installed version. Cheap, covers all dependencies, runs where contributors will actually see it.\n(b) Fold the check into `ndx ci`. Narrower reach: contributors and agents hit `pnpm typecheck` directly, long before `ndx ci`, so the misleading red result still lands first.\n(c) Pin exact versions instead of caret ranges. Removes drift by construction but forfeits patch updates and does not detect an already-stale tree.\n\nCost of (a) is a small script plus a test; the risk is false positives on intentionally-overridden versions, which the report can allow-list."
---
