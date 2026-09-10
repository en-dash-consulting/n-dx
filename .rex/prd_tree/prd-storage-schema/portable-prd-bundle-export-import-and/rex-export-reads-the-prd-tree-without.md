---
id: "315710a1-5e67-4942-89a0-dd534e0ca360"
level: "task"
title: "`rex export` reads the PRD tree without the lock, so a concurrent writer can yield a torn bundle"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`rex export` (bundle and narrative) acquires the PRD lock for the duration of its document load"
  - "An export attempted while another process holds the PRD lock fails loudly naming the holder rather than reading a possibly-torn tree"
  - "A test pins that export waits for or fails on a held lock instead of proceeding (mirroring tests/integration/import-bundle-transaction.test.ts)"
description: "Verdict: should-fix (severity medium). Found by adversarial review of the portable-PRD-bundle branch diff.\n\nFailure scenario: `cmdExport` (packages/rex/src/cli/commands/export.ts:186) calls `store.loadDocument()` with no lock. `serializeFolderTree` writes many files non-atomically, so an export racing a writer — e.g. hench completing a task under `ndx work`, which the concurrency contract classes as safe alongside read-only commands — can capture item A pre-write and item B post-write, or a moved item at both paths. Unlike `rex status`, the result is a durable artifact someone later imports with `--replace`, silently propagating the torn snapshot. Some tears fail loudly at parse; the silent mixed-state case is the hazard.\n\nReachability: `rex export` / `ndx prd export` run while any PRD writer is active. The window is small but the docs actively tell operators exports are safe to run concurrently.\n\nSolution options:\n(a) RECOMMENDED — take the PRD lock for the read span: `withLock(prdLockPath(rexDir), () => store.loadDocument())` in cmdExport (both renderings). Export briefly blocks behind writers; a lock timeout fails loudly naming the holder PID. Do NOT use withTransaction — it always rewrites the tree.\n(b) Accept, and document export as \"do not run during PRD writes\" — free, but contradicts the read-only-is-safe rule operators rely on.\n\nRelated pre-existing exposure (out of scope here): `rex status` and dashboard reads share the unlocked-read class, but their results are transient and self-correcting."
lastModified: "2026-09-10T16:34:25.804Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
