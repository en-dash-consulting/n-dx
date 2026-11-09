---
id: "c21626c3-58f3-4ae6-babb-4b9c55741b94"
type: "task"
title: "Drop level from every v2 payload when v1 is refused"
slug: "drop-level-from-every-v2-payload-when"
description: "Decided with a0940ce9 (Ryan, 2026-10-16). On a v2 tree, level is the v1 projection of type and nesting (a change reads epic or feature). Release N keeps it for v1-era clients and deprecates it in the release note; the release that refuses v1 removes it everywhere at once: MCP (get_next_task, get_item, get_prd_status breakdowns), the dashboard REST payloads (/api/rex/prd and the rest), rex CLI --format=json, and the v2 export bundle. Run b62cfc77 (396995450, 749f8bb02, reverted in 98fe046ea) has a starting point for the MCP and CLI parts (withoutLevel). Ships with 2ea252fe."
acceptanceCriteria:
  - "No v2 payload (MCP, REST, CLI JSON, bundle) carries level; type is the only kind field (tests per surface)"
  - "v1 payloads are unchanged until v1 itself is removed"
  - "The release note names the removal"
priority: "medium"
tags:
  - "lane-migration"
  - "rex"
  - "mcp"
  - "web"
source: "a0940ce9 decision, 2026-10-16"
blockedBy:
  - "2ea252fe-afbf-449d-ad6a-55b3285fd78a"
---
