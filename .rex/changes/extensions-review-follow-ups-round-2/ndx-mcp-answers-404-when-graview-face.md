---
id: "35e2dfd2-9f53-4753-8228-01b4128991b8"
type: "task"
title: "/ndx/mcp answers 404 when graview-face is served under the hub mount"
slug: "ndx-mcp-answers-404-when-graview-face"
description: "Verdict: should-fix (latent: nothing supplies NDX_REX_MCP_URL under the hub today). packages/graview-face/dev/ndx-door.ts:224 normalises the URL for its own checks but passes the raw prefixed req to @graview/core's mcpDoor, which requires request.url === \"/ndx/mcp\" and calls next(). Confirmed: under the hub layout with NDX_REX_MCP_URL set, /ndx/sync-info reports rex: true but POST /ndx/mcp returns 404, so every write-back fails. Fix: hand mcpDoor a request with the base stripped (or construct it with path base + \"ndx/mcp\"); add /ndx/mcp to serve.test.ts."
acceptanceCriteria:
  - "POST /ndx/mcp reaches the MCP door when the face is served under /x/graview-face/"
  - "serve.test.ts covers it"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
