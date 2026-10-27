---
id: "d355da37-c17c-4a29-a18b-96ad2e854555"
type: "change"
title: "Include branch and file attribution in rex API and MCP status responses"
slug: "include-branch-and-file-attribution-in"
intent: "The web server `/api/status` route and the `get_prd_status` MCP tool must propagate `branch` and `sourceFile` fields from PRD items into their response payloads so the dashboard viewer has the data it needs to render attribution badges. This is the data plumbing prerequisite for the UI rendering task."
acceptanceCriteria:
  - "`GET /api/status` response includes `branch` and `sourceFile` on each item node when present"
  - "`get_prd_status` MCP tool response includes the same fields"
  - "The `LoadedData` TypeScript schema in `external.ts` is updated to carry the new fields"
  - "Items without attribution serialize as `null` (not empty string or omitted key) for consistent client-side checks"
  - "No regression in existing status response fields or structure"
touches:
  - "9f96a45d-092e-4ea2-a76d-b21551cedbba"
priority: "high"
tags:
  - "web"
  - "api"
  - "rex"
  - "mcp"
source: "smart-add"
---
