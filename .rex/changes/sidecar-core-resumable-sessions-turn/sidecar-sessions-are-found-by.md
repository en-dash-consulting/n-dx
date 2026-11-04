---
id: "653be274-7cc8-4bcc-81c7-997c470a708a"
type: "task"
title: "Sidecar sessions are found by canonical worktree path, not the exact spelling"
slug: "sidecar-sessions-are-found-by"
description: "#901 F3 (medium, should-fix). routes-sidecar.ts matches a session to the workspace with `session.worktree !== ctx.projectDir` (session GET/POST) and the same exact comparison in the session list. ctx.projectDir is not canonicalized in `ndx start --here` mode (web.js passes resolve(dir)). On Windows the drive and folder case follow what the user typed in cd, and on POSIX a symlinked path argument differs too. After a restart from a differently spelled path to the same checkout, the same .hench/sidecar/index.json loads but GET and POST answer 404 and the list leaves the session out; its resume id and transcript are stranded. Hub mode is unaffected (it passes realpathOrSelf).\n\nDecided: option (a). Compare canonical paths (realpathSync.native, falling back to resolve) in every place the stored worktree is compared with ctx.projectDir.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #901."
acceptanceCriteria:
  - "Every comparison of a session's stored worktree with ctx.projectDir in routes-sidecar.ts compares canonical paths (realpathSync.native, falling back to resolve)"
  - "A route test creates a session, then reads it and lists sessions through a projectDir spelled differently for the same directory (a symlink, or case-varied where the filesystem is case-insensitive) and gets the session"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review:#901-F3"
source: "ndx-adversarial-review"
---
