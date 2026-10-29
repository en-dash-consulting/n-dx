---
id: "70f98e05-28f8-41cd-8b2a-00daf670b08c"
type: "task"
title: "Proxy `/x/<name>/` with auth"
slug: "proxy-x-name-with-auth"
acceptanceCriteria:
  - "HTTP streamed and WebSockets piped, prefix stripped, `X-Ndx-Base-Path` added"
  - "Requests without the per-user token are refused before the sidecar; the token cookie and header are not forwarded"
  - "`/x/` is reserved: registering a project id that collides is refused"
  - "Unknown, disabled or unapproved names answer 404 with the reason"
priority: "high"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "ef7ca789-393d-4663-ac58-8aba713c51ad"
---
