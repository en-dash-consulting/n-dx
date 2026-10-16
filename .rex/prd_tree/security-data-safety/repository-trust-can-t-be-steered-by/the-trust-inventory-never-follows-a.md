---
id: "d03c70ca-3af9-4dd0-9494-5cf006c3e794"
level: "task"
title: "The trust inventory never follows a symlinked directory out of the repository"
status: "pending"
priority: "medium"
tags:
  - "security"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Closes #686 (finding 4)"
  - "The inventory walk uses lstat and never descends into a symlinked directory (or resolves it, enforces the repository-root boundary and keeps a visited set)"
  - "The same walker covers .rex/prd_tree/, .rex/product/ and .rex/changes/, under both the .rex/ and .ndx/rex/ layouts"
  - "Fixtures: an external-directory link and a symlink loop; the inventory counts only items inside the repository and returns promptly; the tests fail on origin/main 9f6a0e963"
description: "#686 finding 4 (medium, should-fix):\n\n> The inventory walk in `repo-trust.ts` (around lines 490–515) uses `statSync(full).isDirectory()` and recurses, with no `lstat`, no repository-root boundary and no visited set. A checkout with a tracked directory symlink can make `evaluateRepoTrust()`, which runs before trust is accepted, enumerate outside the repository or loop indefinitely on a symlink cycle.\n>\n> **Fix:** skip symlinked directories (`lstatSync`), or resolve them and enforce the repository-root boundary with cycle detection. Add fixtures for an external-directory link and a loop.\n\nReproduced 2026-10-16 on the built origin/main: a `.rex/prd_tree/ext` link to an outside directory holding three `index.md` folders counts 3 items; a self-loop under a one-item tree counts 32 items before ELOOP stops it.\n\nThis repository moves to the v2 PRD soon, so the same walk must cover the v2 folders `.rex/product/` and `.rex/changes/` as well as `.rex/prd_tree/`, and the `.ndx/rex/` container layout (`resolveLayout(...).rexDir`). One walker for every tree root, not a fix per root. Read-only: do not change rex's folder-tree parser or migrations (owned by the v2 migrate stack)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:27:42.101Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
