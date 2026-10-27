---
id: "31307b89-23f6-452a-bd9d-b765e4c23901"
type: "task"
title: "Give Codex Sidecar sessions the ndx-sidecar broker"
slug: "give-codex-sidecar-sessions-the-ndx"
description: "Story 04 spawns Codex Sidecar sessions read-only (--sandbox read-only, -c approval_policy=never), but gives them no MCP server: no Codex CLI was available to check how codex exec takes a Streamable HTTP MCP server with headers (-c mcp_servers.ndx-sidecar.url / http_headers, or a config file), or whether exec resume accepts it. As things stand, a Codex session can read but cannot raise any card. Wire the broker endpoint (sidecar/spawn-policy.ts, sidecarSpawnFlags) into the Codex spawn, on fresh and resumed turns alike, and make sure the operator's own ~/.codex/config.toml MCP servers are not loaded."
acceptanceCriteria:
  - "a Codex Sidecar turn lists the nine ndx-sidecar tools and no MCP server from the operator's Codex config"
  - "a test asserts the Codex argv on fresh and resumed turns"
  - "a broker write tool called from Codex waits on its card"
priority: "medium"
tags:
  - "sidecar"
  - "follow-up"
source: "hench-follow-up"
---
