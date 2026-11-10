---
id: "bf33ecdf-ee3a-4324-b26f-9536834a1a15"
type: "task"
title: "POST /unplace edits the change's touches in the web server, skipping rex's open-change and rule checks"
slug: "post-unplace-edits-the-change-s"
description: "Verdict: should-fix (low). packages/web/src/server/routes-rex/placement.ts handleUnplace mutates change.touches and needsPlacement itself, while every other placement write goes through rex (recordPlacement: placeableChange refuses a cancelled or deleted change, and refuseRuleErrors runs). Scenario: POST /api/rex/changes/<cancelled id>/unplace {target} succeeds and rewrites a cancelled change's touches and needsPlacement; MCP and the CLI have no way to undo a touches at all, so the dashboard and rex disagree on what an undo is. Its refusal for \"does not touch\" reuses kind not-a-target, whose hint (\"Choose a capability or constraint...\") does not fit. Reachable through the route directly; the dashboard only offers Remove on homes placed in the visit. Options: (1) recommended: add recordUnplacement to rex core/change-place.ts (open-change check, rule check, own refusal kind), export it through the rex gateway (+1 export, under the 137 ceiling) and call it from the route; cost is small, and it makes the undo available to MCP place_change later. (2) Keep the logic in web and add the open-change check only; cheaper, but the contract drift stays."
acceptanceCriteria:
  - "POST /api/rex/changes/:id/unplace on a cancelled change answers 422 change-not-open and writes nothing"
  - "The touches removal is a rex function (core/change-place.ts) that the web route calls through rex-gateway.ts, with a rex unit test"
  - "A target the change does not touch is refused with its own refusal kind and a matching REFUSAL_HINTS entry"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
