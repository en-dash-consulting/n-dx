---
id: "5be03632-5b61-41b6-887e-6a5fd9094413"
level: "task"
title: "ndx start runs a second dashboard instead of restarting this directory's own token-protected server when its PID file is gone"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With this directory's own token-protected server on the requested port and no PID file, `ndx start --here` stops that server and binds the requested port instead of relocating (unit test in tests/unit/web-port-occupant.test.js)"
  - "A token-protected n-dx server for a different directory or another user's token on the requested port is still left running and start relocates (existing test keeps passing)"
  - "No probe sends the per-user token to an occupant that has not been identified as this user's n-dx server"
description: "Verdict: should-fix (introduced by commit 302db1b83, which made token-protected n-dx occupants relocate instead of being killed).\n\nFailure scenario: a user runs `ndx start --here --port=3117 <dir>` with auth on, which is the default. The PID file `.n-dx-web.pid` is later removed while the server keeps running, for example by `git clean -fdx` or by starting from another checkout of the same tree. The user runs `ndx start --here --port=3117 <dir>` again. The occupant probe (`probeStatusEndpoint`, packages/core/web.js) sends no token, so the server answers 401. The occupant is classed `unknown`, and `probeTokenProtectedNdx` reports it as a protected n-dx server. Start therefore relocates to :3118 and logs \"A token-protected n-dx server is already on :3117\". Now two dashboards serve one directory. The old one is orphaned: `ndx start stop` stops only the new one. The documented contract is that `ndx start` restarts this directory's own untracked server (see the `self` kind in `classifyPortOccupant`). Before 302db1b83 the old server was SIGKILLed and restarted, but that same path also SIGKILLed other projects' auth-enabled dashboards, which is the worse defect.\n\nReachability: `ndx start --here` (the single-project path) after the PID file is lost. The hub path is unaffected.\n\nOptions:\n(a) Recommended: if the occupant is protected, compare its listener pid (`listenerPidsOnPort`) with the PID recorded in this directory's port/pid markers, or check whether the process's cwd/argv names `serve ... <absDir>`. Restart only on a positive match; otherwise relocate. Cost: small, plus a unit test. Risk: argv inspection is platform-specific (ps vs wmic).\n(b) Send the per-user token on the probe so a same-user server answers 200 and is classified self or peer. Cheap, but it hands the credential to whatever process holds the port, including another account's listener. That is what the token exists to prevent. Not recommended.\n(c) Keep relocating, but say in the log that if this is your own server you should run `ndx start stop`, or kill PID N. Cost: trivial. Leaves the duplicate in place."
lastModified: "2026-10-06T15:25:21.073Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
