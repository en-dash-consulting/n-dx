---
id: "3682f9d4-b492-4ef5-bfc7-90de239c311b"
type: "task"
title: "Amends preview ignores another open change already amending the target"
slug: "amends-preview-ignores-another-open"
summary: "When someone chooses to amend a requirement that another open change is already amending, the preview promises an outcome the tools may later refuse. This warns them, naming the other change."
description: "Verdict: should-fix (severity medium), from the adversarial review of feat/placement-visuals.\n\nTrigger: a shortlist candidate with amendedBy: ['C-12'] (rex fills it from other open changes, rex/src/core/change-place.ts:238). Choose Amends and edit a criterion: the preview says '3 criteria (+1 added)' and 'Amended by X when it is applied', and the button reads 'Amend Refunds'. But whichever change applies first moves that spec, and apply then refuses an amends placement made against the old one (server/sidecar/place-packet.ts:91). The form never showed amendedBy before this branch, but this branch now asserts the after-state.\n\nEvidence: components/placement-preview.ts:152; components/prd-tree/change-placement.ts:535-574 (previewOf never reads amendedBy).\n\nFix (cheap, low risk): pass amendedBy through previewOf → placePreview; for amends, add a why line and a non-'changed' after line naming the other change(s) and the apply-order caveat. One unit test."
acceptanceCriteria:
  - "When the chosen target is already amended by another open change and the relation is amends, the preview names that change and says the first to apply wins and the other may be refused"
  - "The preview's after-state is not shown as a plain change in that case"
  - "A unit test covers a candidate with amendedBy"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
