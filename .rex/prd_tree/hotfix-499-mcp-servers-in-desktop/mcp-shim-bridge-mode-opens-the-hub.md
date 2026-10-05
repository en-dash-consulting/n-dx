---
id: "99aea49e-110e-4d42-a4da-879c14ad508c"
level: "task"
title: "MCP shim bridge mode opens the hub session for the client's worktree from MCP roots"
status: "pending"
priority: "high"
tags:
  - "core"
  - "mcp"
  - "hub"
  - "worktree"
source: "ndx-capture"
acceptanceCriteria:
  - "With the hub running and the repo registered, a desktop session in worktree B, whose `n-dx rex mcp .` started with cwd = main checkout A, has its tool calls served by a hub session for workspace B (X-Ndx-Workspace = B's key), and add_item writes B's tree."
  - "The client sees one uninterrupted MCP session: no duplicate initialize response, and the shim's own roots/list exchange is never forwarded to the hub."
  - "Clients without roots, roots that resolve to the anchor or to cwd's worktree, and roots in another repository keep today's behaviour (the last case logs one stderr line)."
  - "notifications/roots/list_changed from the client re-targets later calls the same way."
  - "No deadlock: the roots/list response is matched in the stdin line handler before the serial forwarding chain."
  - "Unit tests in tests/ or packages/core drive bridgeStdio with in-memory streams and a fake fetch, and cover the re-target, no-roots, timeout and list_changed paths."
description: "Where: packages/core/mcp-shim.js. runMcpShim → resolveHubTarget(server, dir) derives `workspace` from resolveRepo(cwd), before the client has said anything; bridgeStdio then sends that X-Ndx-Workspace on every POST.\nThe hub binds a session's workspace at initialize: packages/web/src/server/routes-mcp.ts handleMcpRequest → createSession(ctx, …) → factory(ctx), with rex: (rctx) => createRexMcpServer(rctx.projectDir) in start.ts. Changing the header mid-session therefore does nothing.\n\nChange bridgeStdio (keep it re-export-free and dependency-injected as it is now):\n1. Remember the client's `initialize` request frame and whether params.capabilities.roots is set. Forward it as today, on the cwd-derived workspace (session S0).\n2. When the client's `notifications/initialized` arrives and roots are supported, forward it. Then write a `roots/list` request to stdout with a shim-owned id (e.g. \"ndx-shim-roots-1\") and hold every later client frame until it resolves or about 2 s passes.\n3. The stdin line handler must recognise the response to that id BEFORE appending to the serial `chain`, and must not forward it. Otherwise the held chain waits on a frame queued behind itself.\n4. Resolve the first file: root with resolveRepo (already imported from ./web.js). Same repoRoot as the target project → workspace = basename of its worktree, or null for the anchor. Different repository → keep the current workspace and log.\n5. If the workspace differs from S0's: replay the remembered initialize and initialized frames against the hub with the new header and no Mcp-Session-Id, swallowing their responses, adopt the new session id, and DELETE S0. Then release the held frames.\n6. Client `notifications/roots/list_changed`: do not forward it (the hub server cannot ask over a POST-only bridge). Re-run steps 2–5.\n7. Log the decision on stderr (`bridging to … (workspace <key>, from client root)`).\n\nThe in-process fallback (runInProcessServer, stdio inherit) is covered by the rex/sourcevision tasks; leave it as is.\n\nChangeset: @n-dx/core patch."
lastModified: "2026-10-05T16:29:24.177Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
