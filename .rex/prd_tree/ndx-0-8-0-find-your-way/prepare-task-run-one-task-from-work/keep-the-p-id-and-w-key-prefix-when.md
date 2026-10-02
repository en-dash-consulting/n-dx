---
id: "62233b70-0a5e-48bb-a2a7-35130bcc9ff9"
level: "task"
title: "Keep the /p/<id>/ and /w/<key>/ prefix when the PRD view rewrites the URL"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "phase-1"
  - "web-viewer"
acceptanceCriteria:
  - "With a base path of /p/n-dx (and /p/n-dx/w/<key>), selecting, deep-linking and deleting PRD items leave a URL that keeps the prefix; a unit test covers each caller."
  - "Copied and shareable PRD links include the prefix."
  - "No viewer code calls history.pushState or history.replaceState with a root-relative path that bypasses appUrl(); a test or lint-style check enforces it."
description: "Behind the hub the viewer is mounted under /p/<id>/ (and /w/<key>/ for a worktree). Selecting an item in the PRD tree rewrites the URL to a bare `/prd/<id>`, so a reload with several projects registered lands on the hub's 409 instead of the project. Reproduced on main @ 6a07165eb: clicking a tree row at http://localhost:3117/p/n-dx/prd navigates to http://localhost:3117/prd/<id>.\n\nCallers that build the path without `appUrl()` (packages/web/src/viewer/base-path.ts:63): `hooks/use-item-selection.ts:72-75` (history.replaceState with `/prd/${item.id}`), `hooks/use-prd-deep-link.ts:75`, `hooks/use-delete-actions.ts:102`, `views/validation.ts:947` (pushState). `hooks/use-route-state.ts` already wraps with appUrl and is the pattern to follow. Also check `components/rex-task-link.ts:157` (buildShareableUrl) and the CopyLinkButton path in `components/prd-tree/task-detail.ts:1554` produce prefixed links. The Prepare task deep link (/work/prep/:taskId) added later in this feature depends on this."
lastModified: "2026-10-02T04:54:40.031Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
