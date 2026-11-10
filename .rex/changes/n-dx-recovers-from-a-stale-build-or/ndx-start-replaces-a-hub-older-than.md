---
id: "98e5a4d9-0b50-4124-a5a9-9745366d2af8"
type: "task"
title: "ndx start replaces a hub older than this ndx and re-registers the projects it served"
slug: "ndx-start-replaces-a-hub-older-than"
description: "Covers hubBuildMismatch, noNonceNote and the restart half of serverRefreshFix in packages/core/web.js. When /api/hub/health reports no build identity, or a version / sourceHash different from the @n-dx/web this ndx spawns, ndx start stops that hub, starts the current build on the same port and home, and re-registers every project from hub.json so each keeps its /p/<id>/ URL, then mints the sign-in nonce as usual. If the old hub has live work (a running ndx work / hench run, or open MCP sessions) the replacement is deferred: ndx start says so and when it will happen (e.g. once the run ends), and offers one flag to do it now; it never tells the user to run ndx hub stop. SAFETY: the operator's live hub runs on 127.0.0.1:3117 with ~/.n-dx as its home and serves 25 projects. Never run 'ndx hub stop', 'ndx start' or anything that stops, replaces or registers with that hub. Every test and manual check uses a temporary NDX_HOME and a free port (hub.port / --port)."
acceptanceCriteria:
  - "When the running hub reports no build identity or a different version/sourceHash, ndx start replaces it with the current build on the same port without the user running ndx hub stop"
  - "Every project in hub.json before the replacement is registered and healthy afterwards on the same /p/<id>/ URL"
  - "ndx start prints a sign-in link carrying ndx_nonce= after replacing an old hub"
  - "With a live run or open MCP session on the old hub, ndx start defers the replacement, says when it will happen, and names a single flag that forces it; no message tells the user to run ndx hub stop"
  - "Tests drive a fake old hub in a temporary NDX_HOME on a free port"
priority: "high"
source: "ndx-capture"
blockedBy:
  - "c4e62e1c-54e8-48e8-92c3-71fc0b7aba7c"
---
