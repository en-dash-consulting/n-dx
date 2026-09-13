---
id: "db80edad-3b99-42a6-a2c7-d294ffe23109"
level: "task"
title: "Print safe recovery commands when a run leaves task-owned work uncommitted"
status: "blocked"
priority: "high"
tags:
  - "pr-06"
  - "hench"
  - "git-safety"
  - "operator-experience"
  - "blocked-on-pr-370"
blockedBy:
  - "b7774208-1ba3-47b4-bcc4-177e6b7ba3aa"
source: "ndx-capture"
acceptanceCriteria:
  - "When a validated task is refused solely because task-owned paths remain uncommitted, the terminal output includes a copy-pasteable, path-scoped recovery sequence with `git diff --check`, `git add -- <exact paths>`, and `git diff --cached --check`."
  - "The generated staging command never uses `git add -A` and contains only paths that Hench attributed to the current run."
  - "When validation failed, review has unresolved must-fix findings, or the dirty paths cannot be safely attributed, the output explicitly says not to commit and points to the relevant failure or review evidence instead of offering a staging command."
  - "Output is safely quoted or otherwise usable in the supported terminal environments, including paths containing spaces."
description: "Improve the completion refusal emitted when a validated task is blocked only because its own files are uncommitted. Give the operator copy-pasteable, path-scoped recovery instructions (including a git add command) without implying that known-bad or unrelated changes should be committed. This extends PR #370's uncommitted-work gate and will be implemented after #370 merges."
lastModified: "2026-09-13T21:29:21.413Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
