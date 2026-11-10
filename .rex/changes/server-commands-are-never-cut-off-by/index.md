---
id: "a0c458df-502c-4632-b390-12b89481cbd6"
type: "change"
title: "Server commands are never cut off by the CLI timeout: start, web, dev, mcp, rex and sv mcp, graview serve and mcp"
slug: "server-commands-are-never-cut-off-by"
intent: "ndx graview serve died after five hours at this repository's global cli.timeoutMs, because the timeout keyed only on the top-level command and the global limit outranked the no-default rule for servers. The stdio MCP servers .mcp.json registers (ndx rex mcp ., ndx sv mcp .) had the same fault: at expiry core killed the server's process tree and the editor lost its connection. The dashboard's copy of the rules disagreed with core's order."
acceptanceCriteria:
  - "ndx start, web, dev, mcp, rex mcp, sv and sourcevision mcp and serve, and graview serve and mcp run until stopped unless cli.timeouts.<command> names a limit; the global cli.timeoutMs does not bound them"
  - "graview emit, check and describe and every other one-shot command stay bounded by the default or cli.timeoutMs"
  - "The dashboard's timeout rules follow core's order, and a test holds its server list to core's"
touches:
  - "888de653-60ad-43bf-843c-a859341d22a3"
priority: "high"
source: "pr-stack:#710"
---
