---
id: "66a2aeb2-8b46-4155-975f-9c1fb0c756db"
level: "task"
title: "`ndx work --resolve` reports bypassPermissions on an untrusted repository, though the run lowers it to acceptEdits"
status: "in_progress"
priority: "medium"
tags:
  - "0.9.0"
  - "task-prep"
  - "hench"
source: "merge"
startedAt: "2026-10-05T16:27:53.434Z"
acceptanceCriteria:
  - "On an untrusted repository, `--resolve --permission-mode=bypassPermissions` reports permissionMode acceptEdits with source repository-trust and a warning; a test covers trusted and untrusted fixtures."
  - "The modal's preflight shows the trust warning when present."
description: "Main's #491 (repository trust) lowers `--permission-mode bypassPermissions` to `acceptEdits` when the repository's execution config is not trusted: cmdRun warns via evaluateRepoTrust/formatTrustWarningForRun and lowers the effective mode (packages/hench/src/cli/commands/run.ts, merged in 3539ad5ca), and runOne clamps per task with applyRepoTrust (packages/hench/src/store/trust.ts). packages/hench/src/cli/commands/run-resolve.ts has no trust handling, so `--resolve` (and the Prepare task modal fed by it) reports the unlowered mode and no warning: the modal shows a permission mode the run will not use. Fix: in resolve, evaluate repository trust the same way, report the lowered value with source `repository-trust`, and add a non-blocking `untrusted-repository` warning (not a refusal) with the trust message; the modal's preflight shows it. Reuse the same functions run.ts uses so the two cannot drift. Patch changeset for @n-dx/hench (and @n-dx/web if the modal changes).\n\n## How to run checks without approval prompts (operator note)\n\nCommands are only pre-approved when they START with `npx`, `node`, `npm`, `git` or `vitest`; never prefix one with `cd … &&`. From the project root: `npx vitest run --root packages/<pkg> [paths]`, `npx tsc -p packages/<pkg>/tsconfig.json --noEmit` (web also `-p packages/web/tsconfig.test.json`), and `npx vitest run tests/e2e tests/integration` for the root policy tests. e2e tests that spawn a CLI need that package's dist rebuilt: `npm run build --prefix packages/<pkg>`."
lastModified: "2026-10-05T16:27:53.809Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
