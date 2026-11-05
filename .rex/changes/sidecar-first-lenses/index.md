---
id: "b1ee136b-d88d-4f2f-848d-70db805df38b"
type: "change"
title: "Sidecar first lenses"
slug: "sidecar-first-lenses"
intent: "Batch M3 of the Sidecar epic (CAOS 3f7a80b7-1924-8104-9ed8-c98bc5f409e4; features Sidecar integration 3dfa80b7-1924-81eb-af9c-f6ce9e57beac and Sidecar drawer 3dfa80b7-1924-8124-9648-e416e6b9407a), stacked on M2 (change 1eb1ed53, PR #902). Approved broker calls carry out their effect for the tools M3 needs (run_command and start_work through the job model, propose_prd_change through the capture path), the change-set card, the Sidecar section of Workflow settings, and the Explain and Describe lenses. Merges behind web.sidecar and turns on with M1 and M2 as one release. Design: local-design-workshop/docs/analysis/sidecar/README.md §4, §5, §12, §13.1, §15."
acceptanceCriteria:
  - "Stories 11, 12, 15, 16 and 17 of the Sidecar design (§12, §15.1) are complete"
  - "web.sidecar stays off by default, and every new route and entry point reads it"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "high"
source: "caos"
---
