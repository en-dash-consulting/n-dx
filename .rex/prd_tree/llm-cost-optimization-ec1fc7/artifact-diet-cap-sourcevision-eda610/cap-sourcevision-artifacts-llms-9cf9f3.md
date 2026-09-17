---
id: "9cf9f321-ac04-4e08-9a2f-5ddb3c418a66"
level: "task"
title: "Cap sourcevision artifacts: llms.txt file table, CONTEXT.md routes, zones MCP resource"
status: "completed"
priority: "medium"
tags:
  - "sourcevision"
  - "artifacts"
  - "context"
source: "ndx-work"
startedAt: "2026-08-31T14:27:35.584Z"
completedAt: "2026-08-31T15:10:57.566Z"
endedAt: "2026-08-31T15:10:57.566Z"
acceptanceCriteria:
  - "The llms.txt file table is capped, with a marker stating how many files were omitted and the total"
  - "The CONTEXT.md routes section is capped consistently with the existing findings cap, with an omission marker"
  - "The zones MCP resource returns compact JSON with no pretty-print indentation"
  - "The zones MCP resource returns a summary rather than every zone's full file list, and names get_zone for detail"
  - "Artifacts stay bounded for a large synthetic inventory, verified by test"
description: "Three uncapped outputs that tax every downstream consumer. buildFileInventory (llms-txt.ts:285) loops every inventory file into a markdown table with no bound — 75KB of 108KB measured on n-site. The CONTEXT.md routes section (context.ts:143-177) prints the full route tree plus every server-route group and every route within it, while findings and next-steps immediately below are already capped at 15. The sourcevision://zones MCP resource (cli/mcp.ts:508) returns JSON.stringify(zones, null, 2) — the whole file, pretty-printed, ~80K tokens in one tool result. Cap each with an accurate omission marker, drop the billed indentation, and have the zones resource return a zone summary that points at the existing get_zone tool for per-zone detail rather than inventing resource pagination."
lastModified: "2026-08-31T15:10:57.573Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
