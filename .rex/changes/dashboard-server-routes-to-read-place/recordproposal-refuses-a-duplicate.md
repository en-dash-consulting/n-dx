---
id: "db652118-ffa4-4b4d-afec-8a3b0dba43e4"
type: "task"
title: "recordProposal refuses a duplicate proposal on the same change"
slug: "recordproposal-refuses-a-duplicate"
description: "PR 1 review finding. `recordPlacement` refuses a second amendment on the same target (`already-amends`), but `recordProposal` in `packages/rex/src/core/change-place.ts` has no equivalent. Each proposal mints a fresh UUID target, and apply (`applyAdded` in `core/apply-amendments.ts`) checks only id collisions. So proposing the same title under the same area twice stores two `added` amendments, and applying the change creates two identical capabilities. The dashboard routes in this change make that likely: a double-click, a retried POST, or Place & next after a slow response.\n\nRefuse, before writing, an `added` amendment the change already carries with the same `type`, the same `under` (compared as resolved area ids, so a display id and an id match) and the same title (trimmed, case-insensitive). Add a `ChangePlacementError` kind `already-proposed` with a `plain` message naming the existing proposal's title and area, and map it in the CLI's `placementRefusal` (`cli/commands/change.ts`) and through MCP `place_change` (which already returns the error message). A different title, a different area or a different type is still allowed.\n\nThis lands first in PR 2 because the propose route calls `recordProposal`; it is rex-only and touches no web file."
acceptanceCriteria:
  - "recordProposal refuses a second added amendment with the same type, area and title (trimmed, case-insensitive) on the same change, with ChangePlacementError kind already-proposed and a plain message"
  - "The area matches whether under was given as an id, display id or alias"
  - "A proposal with a different title, area or type on the same change is still recorded"
  - "rex change place --propose and MCP place_change propose both refuse the duplicate and write nothing"
  - "ChangePlacementErrorKind exported from public.ts includes already-proposed"
  - "Unit tests in change-place.test.ts cover the refusal and each allowed variant; product-change-v2.test.ts and mcp-product-tools.test.ts cover the CLI and MCP refusal"
priority: "high"
tags:
  - "inbox-placement"
  - "rex"
source: "ndx-capture"
---
