---
id: "eef3d129-ffc2-4598-bfce-a30c88faf4ef"
type: "change"
title: "Run and queue rules: classify failed runs and plan the ready queue"
slug: "run-and-queue-rules-classify-failed"
intent: "Batch R1 of the Sidecar epic (CAOS 3f7a80b7-1924-8104-9ed8-c98bc5f409e4, feature Diagnosis and guidance 3f7a80b7-1924-81ae-b28f-c6af5dd8ea48). Two rule-based, LLM-free sources in hench that are useful without the Sidecar: a run classifier (hench runs diagnose <id> --format=json, verdict banner on the task page) and a queue planner (ndx work --plan-queue --format=json, 'Ready next' on Live). The Sidecar's Diagnose run and Guide lenses narrate them later. Ships alone. Design: local-design-workshop/docs/analysis/sidecar/README.md §5 (Guide, Diagnose run), §12, §15."
acceptanceCriteria:
  - "Stories 18 and 20 of the Sidecar design (§12, Diagnosis and guidance) are complete"
  - "Both outputs are advisory and never start a run"
touches:
  - "3415b5f0-3496-4813-8cc9-9f571044d49c"
  - "6b0c3873-5607-4adc-9027-abd8d70ab0e3"
priority: "high"
source: "caos"
---
