---
id: "52d7ea63-5637-4e35-a49a-3e86ad7a8c9f"
level: "task"
title: "On a v2 tree, edit_item, move_item, merge_items and claim_task reject a display id that get_item accepts"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-33"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On the v2 fixture, edit_item({ id: \"CH-1\" }) edits change c0000000-0000-4000-8000-000000000001 (test)"
  - "move_item, merge_items and claim_task accept a display id on a v2 tree, the same way get_item does (test per tool)"
  - "`rex update CH-1 …` on a v2 tree resolves the display id (or an alias) to the change, through the same lookup get_item uses (test)"
  - "v1 lookups are unchanged (existing tests pass)"
description: "Found by an adversarial review of c026ba0d (The rex MCP tools serve a v2 tree). Verdict: should-fix, severity low.\n\nScenario: on a v2 tree, get_item resolves a reference by id, display id or alias (cli/mcp-tools/get-item.ts getV2Item, using indexTree().resolve). edit_item, move_item, merge_items and claim_task look the reference up through ChangeLayerStore.getItem / findItem, which match by id only. An agent calls get_item(\"CH-1\") and gets the change. It then calls edit_item({ id: \"CH-1\", ... }) and gets \"Item \\\"CH-1\\\" not found. Use get_prd_status to see available items.\" No data is corrupted; the call is refused with a misleading message.\n\nReachable: any MCP client on a v2 tree that passes the displayId it read from get_item. Not covered by any test.\n\nOptions:\n1. (Recommended) Add a resolver, used by these four tools on the change-layer store, that maps a display id or alias to the node id through indexTree before the lookup. Cost: one helper plus one test per tool. Risk: low; v1 is unchanged if it is gated on isChangeLayerStore.\n2. Keep id-only lookup, but on a v2 miss say that these tools take the item id and name it when the reference is a known display id. Cheaper, but the two tool families still disagree.\n\nAlso the rex update CLI (review of 38978e4a, run daea9d78, 2026-10-12): packages/rex/src/cli/commands/update.ts:55 resolves the id with resolveItem over the projected items (id or title only), so `rex update CH-1 --status=completed` on the v2 fixture fails with `Item \"CH-1\" not found.` The review could not add this itself because the run was not permitted to edit PRD items."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T07:50:23.295Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
