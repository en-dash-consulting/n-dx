---
"@n-dx/core": patch
"@n-dx/web": patch
---

`ndx start` asks who is on the port before killing it, and steps aside for another project's dashboard.

The PID file `runWeb` consults lives inside the directory it was given, so a
second project or worktree had no entry there. A busy 3117 therefore read as a
stranger squatting on the port and `killPortOccupant` SIGKILLed it — including
when the occupant was another project's working dashboard. The server's own
fallback allocator (`findAvailablePort`, 3117–3200) never got a chance to run,
because the orchestrator killed first.

A busy port is now probed with a 1.5 s `GET /api/status` before anything is
killed:

- an n-dx dashboard reporting a **different** `projectDir` is left alone, and
  this invocation moves to the next free port in 3117–3200;
- an n-dx dashboard reporting **this** directory is restarted as before — that
  is `ndx start`'s documented idempotency, reached here when the PID file is
  missing;
- anything else, including a dashboard too old to report `projectDir`, keeps
  today's behaviour exactly. An inconclusive probe never widens the kill.

`GET /api/status` gained a top-level `projectDir` so the probe has something to
attribute the server by. Purely additive.
