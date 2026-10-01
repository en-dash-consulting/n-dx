---
id: "1bec62fb-a9f6-46c2-a5d9-5e602b88a21d"
level: "task"
title: "Every useLive instance shares the poller key \"live\", so the first unmount stops polling for the Live tab, badge and pill"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With the Live tab, bottom bar and /live page all mounted, navigating away from /live leaves exactly one live poller registered and it keeps firing (unit test that mounts two consumers and unmounts one)."
  - "At most one /api/live WebSocket is open per page, however many components read live data."
  - "After the live WebSocket closes, the client reconnects with backoff and the Live tab count updates again (unit test with a closed socket)."
  - "Existing live-tab, live-bar and live-view tests pass."
description: "Failure: `packages/web/src/viewer/hooks/use-live.ts:284` calls `usePolling(\"live\", fetchLive, …)` from every instance. `registerPoller` in `polling/polling-manager.ts:206-229` replaces any entry with the same key, and its unregister removes whatever entry holds that key. Four instances mount at once (App in `main.ts:140`, LiveTab `components/live-tab.ts:183`, BottomBar `components/bottom-bar.ts:51`, LiveBar `views/live-bar.ts:64`), plus LiveView through `useLiveFeed` (`views/live.ts:410`) on /live. Open /live, then go to Work: LiveView and LiveBar unmount, `unregisterPoller(\"live\")` runs, and the nav tab, the bottom-bar analysis badge and the sessions pill update only from the WebSocket. `useLiveFeed` never reconnects after `onclose` (lines 263-265), so after a socket drop (for example a server restart) the tab shows the old count for the rest of the session and a stuck run never appears. Each instance also opens its own WebSocket and fetch: 3 sockets on every page, 5 on /live.\n\nReachability: every user who visits /live and navigates away. Verified in code during the end-of-branch review. No test mounts two instances.\n\nVerdict: must-fix (ndx-adversarial-review, severity high).\n\nOptions:\n- (a) Recommended: a module-level store with reference-counted subscribers, so there is one fetch, one socket and one poller however many components read it, plus reconnect with backoff on close. Medium cost, low risk.\n- (b) Minimum: a unique poller key per instance (counter or useId). Small cost, keeps N sockets and still needs reconnect."
lastModified: "2026-10-01T15:21:26.845Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
