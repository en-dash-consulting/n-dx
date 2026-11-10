---
id: "a2f27dcc-4c2d-4dd0-9b22-89c5a0956a00"
type: "change"
title: "Sidecar places Inbox changes through a reviewed placement card"
slug: "sidecar-places-inbox-changes-through-a"
intent: "Batch L2 of the Sidecar epic, less story 24 (shipped in L1): the Place lens (story 29) and decidedBy on Sidecar placements (story 31). The Inbox read, Plan › Inbox and the place/propose routes already landed with the Inbox stack (#892–#899); this change adds the lens, the placement card's effect and the decision record. Stacked on L1 (feat/sidecar-l1-rule-lenses, #945). Design: local-design-workshop/docs/analysis/sidecar/README.md §5 Place (Q8), §12 rows 29 and 31."
acceptanceCriteria:
  - "Stories 29 and 31 of the Sidecar design (§12) are complete"
  - "Nothing in this change turns on web.sidecar or rex.placementDraft, and on a v1 tree the Place lens stays unavailable, saying it needs a v2 PRD"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "high"
source: "ndx-capture"
---
