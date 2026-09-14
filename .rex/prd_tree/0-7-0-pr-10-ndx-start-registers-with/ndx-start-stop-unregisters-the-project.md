---
id: "9bc85bfd-8071-4ff7-abe9-7ede8d4833b4"
level: "task"
title: "ndx start stop unregisters the project; hub exits with its last project unless hub.keepAlive; status reports hub and project state"
status: "pending"
priority: "medium"
tags:
  - "pr-10"
  - "core"
blockedBy:
  - "3ef3366c-7d84-4f33-a0e0-3f9c3f368e61"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "stop from one of two worktrees keeps the project served; stop from the last unregisters and, with keepAlive unset, the hub exits."
  - "status output covered by a unit test on the formatter."
description: "stop: DELETE /api/hub/projects/<id>/worktrees/<encoded path> (a project with other worktrees still registered stays up; the last one unregisters the project and stops its child). The hub exits itself when its registry becomes empty unless ~/.n-dx/config.json has hub.keepAlive = true; add `ndx hub stop` to stop it explicitly and `ndx hub status`. `ndx start status` prints: hub (pid, port, uptime), this project (id, repo root, child port, worktrees registered), and the URL. Remove pid/port files written in pr10.t2 on stop."
lastModified: "2026-09-10T20:12:19.999Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
