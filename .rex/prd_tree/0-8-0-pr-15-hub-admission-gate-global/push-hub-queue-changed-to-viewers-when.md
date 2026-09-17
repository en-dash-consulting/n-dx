---
id: "ca54925b-bf8a-4507-af06-67a04ba96ad6"
level: "task"
title: "Push hub:queue-changed to viewers when the admission queue moves"
status: "pending"
priority: "medium"
tags:
  - "pr-15"
  - "web"
  - "carried-over"
source: "admission-gate task 37458c57, 2026-09-16"
acceptanceCriteria:
  - "A viewer under /p/<id>/ learns the queue moved without reloading"
  - "The push carries the workspace so a strip showing one worktree does not react to another's entry"
  - "No WebSocket frame parsing is added to the proxy's upgrade path unless hub-side termination is chosen deliberately"
description: "Carried over from the admission-gate task (2026-09-16), which built everything else in it.\n\nWHAT IS MISSING. The gate queues, drains and reports, but a viewer only learns about it by asking: `GET /api/hub/queue` returns the limits, the running count, the queued entries and the memoryPaused flag, and `AdmissionGate` already calls an `onChange(snapshot)` hook on every change. Nothing pushes.\n\nWHY IT WAS NOT BUILT. The hub has no WebSocket server of its own. `handleProxyUpgrade` pipes upgrades to the addressed project's server over node:net as raw bytes, deliberately — the hub never parses a frame. So \"broadcast hub:queue-changed to the affected project's clients, tagged with workspace\" needs infrastructure that does not exist yet: either the hub terminates WebSocket connections itself and multiplexes project frames through them, or it gains a side channel to each child (an internal POST the child rebroadcasts to its own clients). Both are real designs with real trade-offs, and neither has a consumer until the PR 13 Overview machine strip lands.\n\nOPTIONS.\n1. Child relay: the hub POSTs the snapshot to an internal endpoint on each affected child, which broadcasts it to its own WebSocket clients as a normal frame. Smallest change, keeps the hub frame-free, costs one new child endpoint that only the hub may call.\n2. Hub-side WebSocket termination: the hub accepts the upgrade, holds the client socket, and relays both directions. Most control, largest change, and it puts frame parsing in the one component that has so far avoided it.\n3. Poll from the viewer: the strip asks /api/hub/queue every few seconds. No new infrastructure; a queue position that lags a few seconds is not obviously worse than one that arrives instantly, since the wait itself is minutes.\n\nRECOMMENDED: 3 first (it is what the strip can do today with no hub change), then 1 if the lag proves to matter. Wire the existing onChange hook to whichever lands.\n\nACCEPTANCE CRITERIA\n- A viewer under /p/&lt;id&gt;/ learns the queue moved without reloading.\n- The mechanism carries the workspace, so a strip showing worktree B does not react to worktree A's queue entry.\n- No frame parsing is added to proxy.ts's upgrade path unless option 2 is chosen deliberately."
lastModified: "2026-09-17T02:35:50.824Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
