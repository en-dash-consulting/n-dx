---
id: "71bd35bf-5b25-4659-8c37-c8ee6f8c6a86"
type: "change"
title: "A Sidecar work card's title line shows the run options it will actually use"
slug: "a-sidecar-work-card-s-title-line-shows"
intent: "Follow-up to 'Sidecar lenses on the run and branch rules' (6dcba986), found in 99f8a9e1's browser check. A start_work raised with only taskId showed the title 'n-dx work --task=566ba657… --auto .' while its resolve line and the started run carry --require-unblocked. sidecarCardTitle (packages/web/src/viewer/components/sidecar-cards.ts) builds the title from the call's raw options instead of the defaulted ones workOptions (sidecar/carry-out.ts) applies."
acceptanceCriteria:
  - "A work card for start_work with no options shows --require-unblocked in its title line, matching its resolve line and the run's argv (card test)"
  - "An explicit requireUnblocked: false shows no --require-unblocked in the title (card test)"
  - "The title and the server's carry-out read the defaulted options from one shared definition, not two copies"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
discoveredFrom: {"item":"6dcba986-4fe6-4d8d-ab84-54d45db119b1"}
source: "ndx-capture"
---
