---
id: "31ef3101-bfde-437f-bd0e-3da6f29bc9f4"
type: "task"
title: "A malformed criteria on a model proposal drops the whole proposal, title and summary included"
slug: "a-malformed-criteria-on-a-model"
description: "Verdict: should-fix (low). Found by the adversarial review of run 0432117d (task 1d16648d).\n\nScenario: the prd.place prompt now asks for optional criteria.add. asProposal (packages/rex/src/core/placement.ts) validates the whole proposal against AmendmentSchema, whose CriterionSchema needs {id: non-empty, text}. A model reply with criteria {\"add\": [\"Apple Pay\"]} or an entry missing id fails the schema, and placeChange drops the entire proposal with a warning. Before this prompt change models rarely sent criteria, so a usable title/under/summary would have survived.\n\nReachability: the dashboard draft route and capture-time placement, whenever the model proposes.\n\nOptions:\n1. In place-reason (or placeChange), strip an invalid criteria from a model proposal with a warning before asProposal, keeping the rest. Small; keeps asProposal the one definition for callers. Recommended.\n2. Leave it; the prompt shows the {id, text} shape, so most models comply. No cost; an occasional draft is lost whole."
acceptanceCriteria:
  - "A model proposal with malformed criteria is kept without its criteria, with a warning naming the dropped criteria"
  - "A test feeds criteria.add as plain strings and asserts the proposal's title and under survive"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "inbox-placement"
  - "rex"
source: "ndx-adversarial-review"
---
