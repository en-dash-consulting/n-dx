---
id: "ed068a55-29ae-49ee-9e94-5b1929205f03"
level: "task"
title: "get_product on a large v2 tree exceeds what an MCP client accepts"
status: "pending"
priority: "medium"
tags:
  - "lane-migration"
  - "rex"
  - "mcp"
  - "v2-migrate-l7"
source: "rehearsal gate item 6/7, fresh session 2026-10-16"
acceptanceCriteria:
  - "get_product on this repository's migrated tree answers within the MCP client limit by default (test with a large fixture)"
  - "The full detail for one area or capability is still reachable (test)"
  - "/ndx-capture works from the summary"
description: "Found by rehearsal gate items 6 and 7 (fresh Claude Code session in a rules-only migrated copy of this repository at the L6 tip 40ff3efd2, 2026-10-16; report in the workshop status.md). Not a cut blocker: every MCP write and both skills worked. On this repository's migrated tree, get_product returned 118,442 characters across 2,494 lines and the client refused it (\"exceeds maximum allowed tokens\"). /ndx-capture step 2 calls it, and carried on only because get_prd_status and place_change's shortlist were enough. Smallest fix: a summary by default (areas with capability counts and ids) and the full map only for one area or on request, keeping the output under the client limit. Soft freeze: MCP tool shape, so a release-note line."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T19:37:29.386Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
