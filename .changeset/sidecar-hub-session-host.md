---
"@n-dx/web": patch
---

Adds the hub-scope Sidecar session, still behind `web.sidecar`: one per machine, stored under `<ndx home>/hub/sidecar/` and hosted by a project server holding a host lock (pid and port). The hub serves it at `/hub/session/…`, HTTP and WebSocket, after its token check, forwarding to `/api/sidecar/hub/…` on the host, and moves to another healthy project when the host is unregistered or dies; the new host resumes the session from disk. Every turn opens with the hub snapshot rebuilt for it. The context ceiling is 40k unless `web.sidecarContextCeiling.hub` sets another. The session's Claude CLI gets no built-in tool and only the `ndx-sidecar` broker, whose calls carry out nothing yet. A Codex hub session is refused, because its read-only sandbox can still read repositories.
