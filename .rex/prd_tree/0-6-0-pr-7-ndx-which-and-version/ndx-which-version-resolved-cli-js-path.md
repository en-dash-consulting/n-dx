---
id: "076208cd-50c8-4e8d-937c-67d40e9a77e2"
level: "task"
title: "ndx which: version, resolved cli.js path, install kind, install checkout branch and SHA, project dir; --json; --version --verbose alias"
status: "pending"
priority: "high"
tags:
  - "pr-07"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "`ndx which` from a worktree of this repo shows the ndx-stable path today and the worktree path when invoked via node <worktree>/packages/core/cli.js."
  - "--json output is stable and covered by a unit test; help lists the command."
description: "Add `ndx which [dir]` in packages/core/cli.js (register in help.js and the command manifest used by the dashboard's All Commands view). Output lines: package version (packages/core/package.json), cli path (fileURLToPath(import.meta.url), already exported as NDX_CLI_PATH at cli.js:129), install kind (npm registry install | pnpm global link | workspace checkout: detect by walking up from the cli path for a pnpm-workspace.yaml and by checking whether the path is under a node_modules directory), git identity of the install checkout when it is a git working tree (branch or detached@sha, short SHA; use git rev-parse via child_process here, orchestration tier is allowed), and the resolved project dir. --json emits one object. Make `ndx --version --verbose` print the same. Exit 0 always; missing git is not an error."
lastModified: "2026-09-10T20:11:52.096Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
