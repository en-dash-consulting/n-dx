---
id: "1eb1ed53-df39-458d-b30d-45484de50a2c"
type: "change"
title: "Sidecar drawer"
slug: "sidecar-drawer"
intent: "Batch M2 of the Sidecar epic (CAOS 3f7a80b7-1924-8104-9ed8-c98bc5f409e4; features Sidecar drawer 3dfa80b7-1924-8124-9648-e416e6b9407a and Sidecar integration 3dfa80b7-1924-81eb-af9c-f6ce9e57beac), stacked on M1 (change 9753d37a, PR #901). The operator-facing drawer over M1's session API: shell, transcript and composer, agent picker, ordered permission cards, the missing-CLI state, Sidecar spend in the usage ledger, session target/rename/re-lens with the packet on turn one, the sessions list, and the lens chip with attachment. Merges behind web.sidecar and turns on with M1 and M3 as one release. Design: local-design-workshop/docs/analysis/sidecar/README.md §4, §7, §12, §13.1, §15."
acceptanceCriteria:
  - "Stories 07, 08, 09, 10, 13 and 14 of the Sidecar design (§12, §15.1) are complete"
  - "web.sidecar stays off by default, and every drawer entry point reads it"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "high"
source: "caos"
---
