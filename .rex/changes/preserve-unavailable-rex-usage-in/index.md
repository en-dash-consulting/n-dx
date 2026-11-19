---
id: "603823a8-00bb-4376-a2ca-a1513cc9d37f"
type: "change"
title: "Preserve unavailable Rex usage in rollups and cost presentation"
slug: "preserve-unavailable-rex-usage-in"
summary: "Keep missing usage measurements visibly unknown in usage and cost summaries, rather than implying that an unmeasured call was free."
intent: "User requested checking PR1084 review comments, confirming the defect and performing remediation. The single unresolved P2 is https://github.com/en-dash-consulting/n-dx/pull/1084#discussion_r4623619676, review threadPRRT_kwDOReygx865TLNl, on packages/rex/src/analyze/llm-bridge.ts244-248 at published head6a6bb3331547997eee9519a3ae5770cf9c0ad374. Confirmation: built production extractRexTokenUsage and extractRexTokenEvents drop usageStatus from failed analyze_token_usage. Synthetic production-shaped unavailable failure becomes calls1/tokens0/no diagnosticStatus, and estimateCostFromTotals returns$0.00/fullyAttributedtrue with no measurement annotation. Successful llm_usage_diagnostic is dropped entirely. Pre-fix operational reproduction is /private/tmp/ndx-pr6-review-pre-fix-reproduction.json; regression must go further by starting at actual completion/bridge outcome, as reviewer requested. OriginalPR6 tasks and accounting follow-up are closed; do not reopen or rewrite them. Create this separate narrow review-remediation unit. Work only in isolated /private/tmp/ndx-pr6-review-remediation-20261118; shared /private/tmp/ndx-parity-pr2 has advanced toPR9 and is read-only for this task, as is original /Users/ryankeith/ndx-core/n-dx. No successor source changes, unrelated captures, merge, auto-merge, credential exposure, production task fixture mutations or pricing policy redesign. Coordinator owns authorized later normal PR6 push and CI; descendant restack awaits user coordination preference."
acceptanceCriteria:
  - "Preserve supported unavailable, malformed and partial completion measurement provenance through extractRexTokenUsage and extractRexTokenEvents, per-model/command/time-period rollups and their existing CLI/dashboard consumers; measured zero stays distinguishable from unknown usage."
  - "Consume successful llm_usage_diagnostic metadata without duplicating calls or token totals already recorded by command-owned usage events; failed calls remain counted exactly once and known measured spend in mixed records is retained."
  - "Carry measurement completeness into cost presentation so missing usage is not presented as a definitive free call or complete total. Keep model-price attribution distinct from measurement completeness, preserve existing pricing/token classes and avoid invented tokens or new budget enforcement policy."
  - "Add disposable regressions starting from supported unavailable/partial Codex completion outcomes through the production bridge/log/readers and cost/reporting paths, including failed and successful diagnostics, measured zero, mixed measured/unknown and legacy logs. Do not only assert raw appendLog event shape."
  - "Run scoped tests, required cli-dev and scheduler-startup checks, changed builds/typechecks, scoped patch changesets and mandatory Astra review/affected gate, then complete with an atomic source/PRD commit and final N-DX-Item trailer. Preserve historical data and completed tasks."
touches:
  - "2e921485-212e-49b8-a00a-f6666144dee4"
  - "fdc6c3d4-34f6-4805-8473-a4e672582582"
priority: "high"
discoveredFrom: {"item":"6ea1141c-9080-44a8-8442-1d67846b8de0"}
tags:
  - "codex-parity"
  - "codex-parity-pr-6"
  - "pr-review"
  - "approved"
source: "ndx-capture"
blockedBy:
  - "59ef46ac-3cae-43e7-89e0-c327f28ef32b"
  - "c271e65c-898c-40af-acb6-a88b631f660f"
---
