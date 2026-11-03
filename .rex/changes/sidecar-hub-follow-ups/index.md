---
id: "89e6dabf-b024-45bb-9be1-b09796a724d3"
type: "change"
title: "Sidecar hub follow-ups"
slug: "sidecar-hub-follow-ups"
intent: "Batch H2 of the Sidecar epic, stacked on H1 (change 73f42fbb, PR #948). Fixes the hub-session findings the H1 runs deferred: the first request after a host refuses on web.sidecar still answers 403, and hub spend lands in whichever project hosts the turn. The other two H2 tasks live under their own review-finding changes (c49072a8 boundary-check extractors, 348b34e6 drawer bundle size). Codex for the hub session stays out: it has no design and no Codex CLI to verify against."
acceptanceCriteria:
  - "The hub session's two deferred findings (same-request failover, hub spend) are fixed with tests"
  - "Nothing in this change turns on web.sidecar"
  - "src/hub/ imports nothing from src/server/ or src/viewer/ and no hub route skips the token check or request-guard"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "medium"
source: "adversarial-review"
---
