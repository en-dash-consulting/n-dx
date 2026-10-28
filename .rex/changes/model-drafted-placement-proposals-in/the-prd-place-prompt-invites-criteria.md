---
id: "35245f99-1235-4515-a5c1-376ddf8329da"
type: "task"
title: "The prd.place prompt invites criteria on a constraint proposal, which apply later refuses"
slug: "the-prd-place-prompt-invites-criteria"
description: "Verdict: should-fix (low). Found by the adversarial review of run 0432117d (task 1d16648d).\n\nScenario: packages/rex/src/analyze/place-reason.ts output section now says a propose \"may also carry\" criteria.add, with no restriction on type. A model proposing {\"type\": \"constraint\", ..., \"criteria\": {\"add\": [...]}} passes asProposal (core/placement.ts), draftedProposal keeps the criteria (core/change-place.ts), and recordProposal does not check type against criteria. The failure surfaces only at apply: apply-amendments.ts:437 fails with \"a constraint has no capability criteria\".\n\nReachability: the dashboard Draft with the model button (rex.placementDraft on) and capture-time placement.\n\nOptions:\n1. Reword the prompt line: criteria only for a capability. Cheapest; needs a census re-record. Recommended, together with 2.\n2. Drop criteria from a constraint proposal in draftedProposal with a warning (and/or refuse it in recordProposal), so a bad draft never reaches apply."
acceptanceCriteria:
  - "The prd.place prompt states that criteria apply only to a capability proposal"
  - "draftPlacement drops criteria from a constraint proposal with a warning"
  - "A test with a model reply proposing a constraint with criteria returns a proposal without criteria"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "inbox-placement"
  - "rex"
source: "ndx-adversarial-review"
---
