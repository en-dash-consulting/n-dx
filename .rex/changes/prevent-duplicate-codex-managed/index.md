---
id: "c271e65c-898c-40af-acb6-a88b631f660f"
type: "change"
title: "Prevent duplicate Codex managed-session and assisted usage charges"
slug: "prevent-duplicate-codex-managed"
summary: "Charge each automated task and review only for its own token spend. Keep assisted work measurable without charging the same work twice."
intent: "Ryan explicitly approved this narrow follow-up capture and fix after actual PR6 execution exposed two accounting defects, and resumed it on2026-11-17 while lifting the push hold. The original PR6 parent and four tasks are completed; create a separate follow-up, do not reopen them. Concrete actual first-D run c2f9ce4f-37a1-4a68-8bd1-6dde247a614d session01a1e6d7-1ff5-71d0-80e1-b4572d4bcbb1: work cumulative5505796 (fresh172579/output25057/cache5308160), final7677627 (fresh199226/output30209/cache7448192), so review delta2171831. Parent recorded13183423=work+final, and automatic assisted record59606f26-9eb0-43ef-9bf5-5407e85daf51 added1372616 already-included tokens, total14556039 versus observed7677627. No dollar estimate. All raw records/numeric boundaries/proposal and failed retries remain preserved externally at /Users/ryankeith/.codex/visualizations/2026/11/16/01a1e674-81d4-7d22-92ee-1a3707b2f3ff/. Related completed18da2319-deb7-42fe-b5da-3dae8347be75 owns nested assisted marks, not managed CLI cumulative phase accounting. Source entry points include hench lifecycle cli-loop chargeReviewToRun/chargeSpawnToRun, spawn adapter usage, session-usage and record commands, and Rex aggregate/per-turn consumers. Follow current gateways, generated-files/public-surface and package AGENTS. No coordinator implementation substitute; actual ndx work owns fix/review/gate/completion. Publishing a draft is now authorized after validation; never merge or auto-merge."
acceptanceCriteria:
  - "Normalize supported Codex same-session work, retry, continuation and resumed review cumulative counters to incremental spend without replay/double charging; new-session spend remains distinct and pre-existing resumed-session counters are not charged again."
  - "Preserve fresh input, cache-read/write and output distinctions, measured failure usage and honest missing, partial, reset or identity-mismatch provenance in aggregate, per-turn/review and downstream usage/budget rollups."
  - "Prevent assisted-skill bookkeeping inside a Hench-owned automated execution or review from charging its already-owned tokens a second time, while standalone assisted and nested mark/repeated-record behavior continues working."
  - "Add meaningful disposable regressions for cumulative resumed review, retry/continuation/replay/reset boundaries, automated versus standalone/nested ownership and downstream ledger totals; distinguish fixture evidence from the actual selected CLI contract."
  - "Preserve all historical raw run/assisted records and explain the observed pre-fix overlap; do not rewrite/delete records, copy production transcript content into fixtures, leak credentials or infer deduplication from timestamps alone."
  - "Complete one actual ndx work execution unit with scoped patch changesets, required root checks, mandatory Astra self-review and full affected outer gate, atomic code/PRD commit and final N-DX-Item trailer. No PR7-9 work, merge or auto-merge."
touches:
  - "347d501b-b8d8-4076-8e85-4b5fe3ab5fce"
priority: "high"
discoveredFrom: {"item":"c73a021f-4560-4bb6-9091-6d1622d860b9","run":"c2f9ce4f-37a1-4a68-8bd1-6dde247a614d"}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-6"
  - "accounting-followup"
source: "ndx-capture"
blockedBy:
  - "59ef46ac-3cae-43e7-89e0-c327f28ef32b"
---
