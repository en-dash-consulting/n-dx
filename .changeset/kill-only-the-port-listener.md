---
"@n-dx/core": patch
---

fix(core): kill only the process listening on a busy port, never a client

`killPortOccupant` selected its victim with `lsof -ti tcp:<port>` and took the
first pid. That query lists every process holding a socket on the port —
CLIENTS included, not just the LISTEN socket — and lsof prints pids in
ascending order, so any older local process with a live or CLOSE_WAIT
connection to the dashboard ranked above the listener and was SIGKILLed in its
place. Observed while writing `tests/e2e/cli-start-two-projects.test.js`: a
vitest worker still holding a CLOSE_WAIT socket 50 ms after its last
`/api/status` request was killed instead of the server, which reported as
`Worker exited unexpectedly` with no assertion, no attribution, and four
orphaned dashboards left behind. Outside tests the candidate victim is a
browser tab, a `curl`, or another CLI connected to the dashboard.

The POSIX query is now `lsof -t -sTCP:LISTEN -i tcp:<port>`, so a client socket
is not a candidate. The win32 `netstat` branch already matched on `LISTENING`
and is unchanged apart from collecting every match rather than the first.

Whom-to-kill is now a separate, pure decision (`selectKillTarget`) with three
refusals, each a case where killing would be a guess: nobody listening, this
process among the listeners (the self-preservation guard, which every
in-process test of the peer path depends on), and several listening pids —
SO_REUSEPORT or a pre-fork server. That last case now fails loudly, naming the
pids, rather than killing one at random; `ndx start` reports the port as
uncleared and the operator still has `--port=N`.

This is the whom-to-kill half of the peer-dashboard work. The `/api/status`
probe decides *whether* to kill, and it cannot protect a client, because a
client is not what `/api/status` describes.
