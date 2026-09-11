---
id: "eee179a1-ef0c-4bca-b741-5187f553e14b"
level: "task"
title: "killPortOccupant SIGKILLs any process holding a socket on the port, not just the listener"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Found while writing tests/e2e/cli-start-two-projects.test.js. killPortOccupant (packages/core/web.js) selects its victim with `lsof -ti tcp:<port>` and takes the FIRST pid. That query lists every process holding a socket on the port — CLIENTS included, not just the LISTEN socket. Any local process with a live or CLOSE_WAIT connection to the dashboard can therefore be SIGKILLed in place of the squatter.\n\nObserved: a vitest worker polling /api/status had a CLOSE_WAIT socket to the port 50ms after its last request; lsof listed the worker ABOVE the listener, and the kill path killed the test runner instead of the server. The suite reported 'Worker exited unexpectedly' — no assertion, no attribution — and left four orphaned dashboards behind. Same shape applies outside tests: a browser tab, a curl, or another CLI connected to the dashboard is a candidate victim.\n\nFix: restrict the query to listeners — `lsof -ti tcp:<port> -sTCP:LISTEN` on POSIX. The win32 netstat branch already matches on LISTENING and is correct. Consider also failing loudly rather than killing when more than one pid comes back.\n\nThis is adjacent to, but distinct from, the peer-probe work in this epic: the probe decides WHETHER to kill, this decides WHOM to kill. The probe does not protect a client, because a client is not what /api/status describes."
lastModified: "2026-09-11T01:57:52.293Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
