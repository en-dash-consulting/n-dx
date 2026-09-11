---
id: "1bf34524-5f93-4824-bf30-a2f5512fbfc5"
level: "task"
title: "findRelocationPort's near window is unclamped, so a peer on port 65535 crashes ndx start"
status: "pending"
priority: "medium"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-02-review"
source: "holistic review of PR 2, 2026-09-11"
acceptanceCriteria:
  - "findRelocationPort(65535) returns a port from the 3117–3200 fallback range instead of throwing."
  - "findRelocationPort(65500) scans 65501–65535 and never attempts a port above 65535."
  - "Behaviour for the default port 3117 is unchanged: the near window is still 3118–3200."
  - "isPortInUse never throws for an out-of-range port (defensive guard, covered by a unit test)."
  - "Unit tests in tests/unit/web-port-occupant.test.js cover the 65535 boundary and the clamped window."
description: "Severity: medium (crash, narrow trigger). Found by holistic review of PR 2, in the fix for item 38a30719 (commit 72fc25b3).\n\nFAILURE SCENARIO\nfindRelocationPort(requestedPort) in packages/core/web.js scans `requestedPort + 1` through `requestedPort + NEAR_PORT_WINDOW` (83) before falling back to 3117–3200. Neither bound is clamped to the maximum TCP port, so the scan can reach 65536 and beyond. isPortInUse() calls net.createConnection({ port }), which throws ERR_SOCKET_BAD_PORT SYNCHRONOUSLY for a port outside 0–65535. That throw happens inside the Promise executor, so the promise rejects, the rejection propagates out of findFreePortInRange → findRelocationPort → runWeb's relocation branch, and `ndx start` dies with an unhandled error instead of relocating or reporting cleanly.\n\nReproduced directly against the built module:\n  findRelocationPort(65535, 83) -> THROWS ERR_SOCKET_BAD_PORT\n  \"Port should be >= 0 and < 65536. Received type number (65536).\"\n\nTrigger: a peer dashboard on port 65535 fails immediately, because the very first candidate (65536) is invalid. A peer on 65453–65534 fails only if every valid port above it in the window is also busy. Both require an explicit --port or web.port up in that range, which is why this is narrow rather than common — but the outcome is a crash, not a degraded start, and the fallback range that would have rescued it is never reached.\n\nSOLUTION\nClamp the near window to the maximum valid port before scanning: `Math.min(requestedPort + nearWindowSize, 65535)`. When requestedPort is already 65535 the near window is empty and the function should go straight to the 3117–3200 fallback. Consider also making isPortInUse defensive (treat an out-of-range port as \"in use\" rather than throwing), so no future caller can reintroduce the same crash."
lastModified: "2026-09-11T13:29:54.890Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
