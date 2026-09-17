---
id: "9bc85bfd-8071-4ff7-abe9-7ede8d4833b4"
level: "task"
title: "ndx start stop unregisters the project; hub exits with its last project unless hub.keepAlive; status reports hub and project state"
status: "completed"
priority: "medium"
tags:
  - "pr-10"
  - "core"
blockedBy:
  - "3ef3366c-7d84-4f33-a0e0-3f9c3f368e61"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-17T00:55:38.701Z"
completedAt: "2026-09-17T00:55:38.701Z"
endedAt: "2026-09-17T00:55:38.701Z"
resolutionType: "code-change"
resolutionDetail: "DELETE /api/hub/projects/:id/worktrees/:path + hub self-exit unless hub.keepAlive; ndx start stop unregisters and clears the markers; ndx start status and new ndx hub status/stop report hub and project state; hub mode is now the default with --here as the opt-out."
acceptanceCriteria:
  - "stop from one of two worktrees keeps the project served; stop from the last unregisters and, with keepAlive unset, the hub exits."
  - "status output covered by a unit test on the formatter."
description: "stop: DELETE /api/hub/projects/<id>/worktrees/<encoded path> (a project with other worktrees still registered stays up; the last one unregisters the project and stops its child). The hub exits itself when its registry becomes empty unless ~/.n-dx/config.json has hub.keepAlive = true; add `ndx hub stop` to stop it explicitly and `ndx hub status`. `ndx start status` prints: hub (pid, port, uptime), this project (id, repo root, child port, worktrees registered), and the URL. Remove pid/port files written in pr10.t2 on stop.\n\n**Carried over from the registration task (2026-09-16).** Hub mode shipped opt-in: `ndx start --hub` or `web.mode: \"hub\"` in .n-dx.json; `--here` forces the legacy server; the DEFAULT is still the single-project server. Flipping the default to hub mode (so `--here` becomes the only way to get the legacy server, per the epic) belongs here, once `stop`/`status` understand hub mode — doing it earlier would leave `ndx start stop` unable to find the server it just started. When flipping: (1) the existing e2e suites that run `ndx start --port=N dir` and read .n-dx-web.pid / relocation behaviour (cli-start.test.js, cli-start-two-projects.test.js, cli-web.test.js, mcp-transport.test.js) must either pass `--here` or be re-pointed at the hub's root alias / /p/<id>/ URLs; (2) `runHubMode` in packages/core/web.js already resolves hubPort from `--port` > ~/.n-dx/config.json hub.port > 3117 and reads `web.mode` via loadConfigMode — invert that check rather than adding a second one; (3) update help.js/config.js text that says \"here\" is the default, and the README/project-guidance HTTP MCP section (still describes single-project HTTP)."
lastModified: "2026-09-17T00:55:39.072Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
