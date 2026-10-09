---
id: "383f9b5f-a72b-44ec-8a99-d37769c50866"
level: "task"
title: "place_change takes the amendment's proposed text and capability criteria"
status: "completed"
priority: "high"
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
  - "pr-review"
source: "pr-review"
startedAt: "2026-10-09T04:10:08.195Z"
completedAt: "2026-10-09T04:25:21.457Z"
endedAt: "2026-10-09T04:25:21.457Z"
resolutionType: "code-change"
resolutionDetail: "place_change takes optional proposed and criteria (AmendmentSchema criteria shape) with target + explicit relation amends and recordPlacement stores them on the modified amendment (base unchanged); apply_change's nothing-to-modify refusal names place_change's proposed and criteria; tests + snapshot updated"
acceptanceCriteria:
  - "place_change accepts optional proposed (string) and criteria ({add?, replace?, remove?}, the AmendmentSchema criteria shape) with target and relation amends, and records them on the amendment (test)"
  - "add_item (Inbox change) → place_change with relation amends and proposed → apply_change applies the amendment through MCP (mcp-transport or integration test)"
  - "The same flow with a criteria delta and no proposed text applies (test)"
  - "proposed or criteria without relation amends is refused with a message naming relation amends (test)"
  - "apply_change's 'nothing to modify' refusal names place_change's proposed and criteria as the way to supply them (test)"
  - "place_change's access stays read without target and write with it; the access table and v1 refusal are unchanged"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "From PR #612 review (ryrykeith, 2026-10-09, P2, packages/rex/src/core/change-place.ts:102). Creating an Inbox change with add_item and then calling place_change with relation amends stores a modified amendment with no proposed text or criteria delta. apply_change then refuses it with \"nothing to modify: no proposed text or criteria delta\", and no MCP tool can supply the missing fields (edit_item is v1-only and has no amendment input). An end-to-end MCP probe confirmed this blocks the Inbox → place → apply workflow. Task 6's review had dropped it as existing apply semantics.\n\nDecided 2026-10-08 (Ryan): place_change takes the content. Add optional `proposed` and `criteria` (same shapes as an amendment in add_item's `amends`, from AmendmentSchema in schema/v2.ts), accepted only with target and relation amends, and pass them into recordPlacement (core/change-place.ts). Without them, place_change records today's summary-only amendment. Not chosen: a v2 edit_item branch, or a new edit_amendment tool. Additive tool shape change; list it in the PR body under the 0.9.0 soft freeze. The amendment's base must still match what apply's checkBase hashes.\n\nLane: packages/rex/src/cli/mcp-tools/place-change.ts, apply-change.ts (message only), core/change-place.ts, tests, the tools/list snapshot."
lastModified: "2026-10-09T04:25:21.749Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
