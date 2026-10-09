---
id: "f7e0ceb7-df75-44dc-bf00-22abee078ca6"
level: "task"
title: "add_item refuses a v2 removal that apply would accept once another open change is applied first"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-17"
  - "rex"
  - "lane-rex-surface"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "add_item accepts a change removing node N while another open change amends N, or refuses it with a message that names the other change as the reason and says to retry after it closes, per the decision (test)"
  - "The chosen classification of refusals as permanent or dependent on current state is documented on applyAmendmentsProblems"
  - "Refusals that hold regardless of other changes (a criteria delta on a constraint, replace or remove on an added capability) are still refused (existing tests stay green)"
description: "Verdict: should-fix (adversarial review of bfb8ed54, which made add_item and place_change dry-run apply via applyAmendmentsProblems).\n\nScenario: v2 PRD where open change A modifies constraint N. add_item {type: change, amends: [{target: N, delta: \"removed\", summary}]} is now refused with \"the result breaks open-change-refs-live: ...\" because the dry run applies the new change against the current tree, where A still amends N. Applying or cancelling A first makes the removal applyable, so this change is refused now but not refused permanently. Before bfb8ed54 add_item accepted it. The same shape occurs when a removal's live descendants are retired by another open change, and (pre-existing, decided in 3dad263b) a criteria delta whose ids only fit after another open change adds them.\n\nEvidence: packages/rex/src/core/change-add.ts (applyAmendmentsProblems after the rules check); core/apply-amendments.ts applyAmendmentsProblems runs the full applyAmendments including newErrors (the rules on the result).\n\nReachable: rex MCP add_item on a v2 tree, while another open change still references the node.\n\nOptions:\n1. (Recommended) Keep the dry run, but leave out problems that depend on other open changes: drop the rules-on-result findings whose nodeId is another change (open-change-refs-live), and the live-descendants refusal. Cheap. Risk: it splits apply's verdict into \"always refuses\" and \"refuses now\", which needs a named classification in apply-amendments.ts.\n2. Accept the narrowing as decided (\"refuse when apply would refuse\") and document it in add_item's description. No code change, but planning a retirement has to wait for the open changes it conflicts with.\nThis is Ryan's call: the 2026-10-09 decision says \"refuse with apply's own error when apply would refuse\" without distinguishing now from always."
lastModified: "2026-10-09T06:22:08.295Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
