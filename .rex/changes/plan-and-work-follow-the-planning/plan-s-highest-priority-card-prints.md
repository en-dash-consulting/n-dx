---
id: "87fd9eb9-74fb-44e6-9e48-33bac7d17ed0"
type: "task"
title: "Plan's Highest priority card prints the raw assignee identity"
slug: "plan-s-highest-priority-card-prints"
summary: "The Highest priority card on Plan says 'Assigned to Ann <ann@x.io>' instead of just the person's name, unlike the rest of the dashboard."
description: "Failure: views/plan-glance.ts writes 'Assigned to ${model.top.assignee}' with the stored identity. Trigger: an open change assigned 'Ann <ann@x.io>' at the top of the order. Reachability: every Plan visit where the top change has an assignee. Verdict: should-fix (low), introduced by efcc0da8e. Fix: personLabel(), as Ready to run and the area boxes use."
acceptanceCriteria:
  - "The Highest priority card names the assignee by personLabel (unit render test)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
