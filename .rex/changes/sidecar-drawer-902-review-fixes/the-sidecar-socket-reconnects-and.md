---
id: "16422d4f-4145-4008-b53e-a4a6ec5d745f"
type: "task"
title: "The Sidecar socket reconnects and catches up after a drop"
slug: "the-sidecar-socket-reconnects-and"
description: "#902 F2 (medium, should-fix). useSidecar opens one socket for the page's lifetime (openWebSocket(), no onclose, no reconnect, no polling fallback), and the drawer depends on it for every frame, for running, and for every sidecar:card refresh. After a server restart, laptop sleep or network drop with the tab still open: send() sets running and fetches frames once, no announcement ever arrives, the composer stays disabled, and a card the broker raises never appears. The broker has no card timeout, so the turn hangs until reload. The rest of the dashboard recovers because use-live.ts reconnects with backoff.\n\nDecided: option (a). Reconnect with backoff as use-live.ts does, and on reopen fetch waiting cards and frames to catch up.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #902."
acceptanceCriteria:
  - "When the Sidecar socket closes while the page stays open, useSidecar reopens it through openWebSocket() with backoff, as use-live.ts does, and stops retrying when the hook unmounts"
  - "On reopen the drawer fetches waiting cards and the frames after its cursor, so a card raised while disconnected is drawn and a turn that finished meanwhile stops showing running"
  - "A test closes the socket mid-turn, raises a card, reopens the socket, and asserts the card and the final frames are drawn"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review:#902-F2"
source: "ndx-adversarial-review"
---
