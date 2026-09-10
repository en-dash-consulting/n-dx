---
id: "a9a2090c-a298-4188-a9e6-5c910ce09a28"
level: "task"
title: "Probe the port occupant before killing it and fall back to a free port when it is another n-dx server"
status: "completed"
priority: "critical"
tags:
  - "pr-01"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-10T20:51:49.614Z"
completedAt: "2026-09-10T22:27:41.027Z"
endedAt: "2026-09-10T22:27:41.027Z"
acceptanceCriteria:
  - "With a dashboard for directory A on 3117, `ndx start B` starts B on 3118 (or the next free port) and A keeps serving."
  - "`ndx start A` while A is running still performs the idempotent restart on 3117."
  - "A non-n-dx occupant on 3117 is handled exactly as before."
  - "Unit test covers the probe decision (n-dx peer → fallback, non-peer → legacy, own stale → restart)."
description: "In packages/core/web.js runWeb(): after the own-pid-file restart path and before killPortOccupant(port), probe the busy port with an HTTP GET to http://127.0.0.1:<port>/api/status (timeout ≤ 1500 ms). If the response parses as the dashboard status JSON (it carries projectDir at top level, see packages/web/src/server/routes-status.ts) and projectDir differs from absDir, do NOT kill: print one line (\"n-dx dashboard for <dir> is already on :<port>; starting this one on :<next>\"), pick the next free port by scanning 3117–3200 with the existing isPortInUse() helper, and pass that port to `web serve`. If the probe fails or the occupant is not an n-dx server, keep today's behaviour unchanged (this task does not decide the non-n-dx case). Keep the orchestration tier spawn-only: no imports from packages, plain node:http/net only. Update the --help text in packages/core/help.js if it describes the kill behaviour."
lastModified: "2026-09-10T22:27:41.034Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
