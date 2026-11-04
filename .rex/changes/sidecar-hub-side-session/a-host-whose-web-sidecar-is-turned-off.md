---
id: "1240c8fa-201e-4663-9f91-384aadd9402f"
type: "task"
title: "A host whose web.sidecar is turned off gives up the hub session host lock"
slug: "a-host-whose-web-sidecar-is-turned-off"
description: "Review of #948, finding F2, option (a). claimHubSessionHost (src/hub/session-host.ts) is never released: when the holder's web.sidecar is turned off, the hub fails over, but the next host's claim sees a live holder and answers 409 until the holder's process exits. Release the lock when the holder's route gate refuses a /api/sidecar/hub/* request, and on server shutdown. Options (b) hub-authoritative takeover and (c) a lease are out of scope; an unregistered or unhealthy holder that keeps running is not covered by this task."
acceptanceCriteria:
  - "A release removes the lock file only while it names this server's pid and port; a lock another server holds is never removed"
  - "When the holding server's route gate refuses a /api/sidecar/hub/* request because web.sidecar is off, it releases the lock; a hub turn still running on it finishes before the release, and no second host takes the session while that turn runs"
  - "A server that holds the lock releases it on shutdown (the close path start.ts already runs), and a crash leaves the dead-pid takeover working as before"
  - "An integration test with two real project servers (startServer) sharing one hub home: A holds the lock, A's web.sidecar is turned off, and B's next /api/sidecar/hub/* request is served rather than answered 409"
priority: "medium"
source: "adversarial-review"
---
