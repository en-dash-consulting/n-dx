---
id: "3e7ede15-0a03-4a07-abfc-fd3ab1fea7cd"
type: "change"
title: "A Sidecar placement approval writes only the placement the operator reviewed"
slug: "a-sidecar-placement-approval-writes"
intent: "Review fixes for #946 (Sidecar L2: Place lens), from Hal's adversarial review of 2026-11-04. F1 (must-fix, routes-sidecar.ts:756): an edited placement card is re-checked at approval and pinned to that result, so a target spec that moved while the card waited is overwritten. F2 (placement-card.ts:91): a card whose dry run was refused is approved with no pin and writes whatever rex accepts now."
acceptanceCriteria:
  - "Both findings in the #946 review (F1, F2) are fixed, each with a test that fails without its fix"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
priority: "high"
source: "ndx-capture"
---
