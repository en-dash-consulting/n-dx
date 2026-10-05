---
id: "590da835-03ba-486c-82b3-0df973f6e6fe"
level: "task"
title: "repo-trust.css uses the retired --danger token, failing style-tokens after merging main"
status: "completed"
priority: "high"
tags:
  - "0.9.0"
  - "task-prep"
  - "web-viewer"
  - "ci"
source: "merge"
startedAt: "2026-10-05T16:20:45.905Z"
completedAt: "2026-10-05T16:26:51.708Z"
endedAt: "2026-10-05T16:26:51.708Z"
acceptanceCriteria:
  - "packages/web/src/viewer/styles/repo-trust.css references no retired or undefined token; style-tokens.test.ts passes."
  - "The trust banner's error colour still meets 4.5:1 contrast in light and dark themes."
description: "After merging main (#491, repository trust review) into PR #503, packages/web/tests/unit/viewer/style-tokens.test.ts > \"does not reintroduce retired token names, with or without a fallback\" fails with `expected [ 'repo-trust.css: var(--danger)' ] to deeply equal []`. The check came from this feature's F18 follow-up (c2a4580d5); packages/web/src/viewer/styles/repo-trust.css:79 (from #491) uses `color: var(--danger, #b3261e)`. Replace it with the theme token F18 used for errors (`--red`, defined in tokens.css for both themes) and keep the visual intent. Patch changeset for @n-dx/web.\n\n## How to run checks without approval prompts (operator note)\n\nCommands are only pre-approved when they START with `npx`, `node`, `npm`, `git` or `vitest`; never prefix one with `cd … &&`. From the project root: `npx vitest run --root packages/<pkg> [paths]`, `npx tsc -p packages/<pkg>/tsconfig.json --noEmit` (web also `-p packages/web/tsconfig.test.json`), and `npx vitest run tests/e2e tests/integration` for the root policy tests. e2e tests that spawn a CLI need that package's dist rebuilt: `npm run build --prefix packages/<pkg>`."
lastModified: "2026-10-05T16:26:52.185Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
