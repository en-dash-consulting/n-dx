---
id: "1d16648d-6745-4a48-a0fe-3f413c47f19e"
type: "task"
title: "The prd.place prompt never asks for a statement or criteria, so a drafted proposal leaves the form's statement and criteria empty"
slug: "the-prd-place-prompt-never-asks-for-a"
description: "Verdict: should-fix (low). Found by the adversarial review of run 23067806 (task c4fbfee6).\n\nScenario: draftChangePlacement (packages/rex/src/analyze/place-draft.ts) passes through a proposal's `proposed` and `criteria.add` when the model sends them (draftedProposal in core/change-place.ts). The prompt in packages/rex/src/analyze/place-reason.ts:55 asks only for delta, type, target, under, title and summary. So a real draft from the dashboard's Draft-with-the-model button fills title and summary but never the statement or criteria. It still asks for `\"target\": \"<new-slug>\"`, which the draft discards.\n\nReachability: the draft route (sibling task \"Draft route and Draft with the model button\") once it lands. The migration placement pass uses the same prompt.\n\nOptions:\n1. Add optional `proposed` (one-sentence statement) and `criteria: {add: [{id, text}]}` to the propose shape in the prompt, and drop `target` from what the model is asked for (asProposal requires a target, so place-reason would fill a placeholder that only the migration path reads, or the migration path keeps its own). Costs a prompt change that also reaches migrate-plan; check the prompt census.\n2. Leave the prompt alone and let the person fill the statement and criteria. No cost; the draft stays thinner than the task description implies.\nRecommended: 1, limited to adding the optional fields; leave the target question to the migration's own item."
acceptanceCriteria:
  - "The prd.place prompt's propose shape names optional proposed and criteria.add fields"
  - "A place-reason unit test asserts the prompt asks for proposed and criteria"
  - "A draftPlacement test with a model reply carrying proposed and criteria returns both on the drafted proposal"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "inbox-placement"
  - "rex"
source: "ndx-adversarial-review"
---
