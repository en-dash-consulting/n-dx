---
id: "9a441abb-fc5c-4402-a14d-dfd24b3034e5"
level: "task"
title: "Add get_product, get_capability, place_change and apply_change"
status: "completed"
priority: "high"
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
blockedBy:
  - "fdddee24-1661-4f65-adc7-3946452bc8f8"
source: "roadmap"
startedAt: "2026-10-09T01:19:01.356Z"
completedAt: "2026-10-09T02:13:17.416Z"
endedAt: "2026-10-09T02:13:17.416Z"
resolutionType: "code-change"
resolutionDetail: "Four MCP tool modules over new pure core modules product-report.ts and change-place.ts; get_prd_status v2 branch; manifest, unit tests and mcp-transport e2e. Commit b03c3a745."
acceptanceCriteria:
  - "Each tool has unit tests and is listed in tools/list"
  - "mcp-transport e2e covers one call to each new tool"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "New tools in their own modules. get_prd_status reports per area and per release."
lastModified: "2026-10-09T02:13:17.682Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
