---
id: "1672bb20-6378-4950-847b-30b2508ce3e7"
type: "change"
title: "hench stages only the change-layer paths in rex's save report on a v2 completion"
slug: "hench-stages-only-the-change-layer"
intent: "Review 2026-10-12, PR #692 should-fix 2 (CONFIRMED by trace), hench half. Decision S1-Q3 (Ryan, 2026-10-12): in this round. The rex half, ChangeLayerStore's save report, is b3ae06d2 in PR 34; this task is blocked by it.\n\nScenario (original capture, from the adversarial review of f0f2bab6): a v2 project with an operator edit in flight under .rex/changes/<other>/ or .rex/product/. A hench --auto run completes a task. commitPrdTreeIfStaged (packages/hench/src/agent/lifecycle/shared.ts:2406-2420) calls takeSaveFileReport(store) (:4267). Without a report from rex it falls back to the wholesale roots from prdPathsToStage, which include <rexDir>/product and <rexDir>/changes (uncommitted-work-gate.ts:119-124). The operator's unrelated edit lands in the \"task completed\" commit under hench's trailers, the hazard WM2040 fixed on v1. The review adds that PR 36's dashboard Quick Add and status PATCH make this routine whenever `ndx start` and `ndx work` run together, which the concurrency contract marks safe.\n\nTest gap: tests/integration/completion-metadata-commit.test.ts:628 mocks a save report that no v2 store produced; the real v2 path (wholesale staging) has no test.\n\nFix: once rex's ChangeLayerStore returns a save report, hench stages only the change-layer paths in it, never product/ and changes/ wholesale. Make sure the report hench reads covers the completion's writes even when completeV2Work runs on a different store instance. Replace the mocked-report test with one on the real ChangeLayerStore. Correct the changeset wording (\"as they do prd_tree/ on v1\")."
acceptanceCriteria:
  - "Completing a v2 task through the real ChangeLayerStore on the autoCommit path leaves an unrelated dirty file under changes/ (and one under product/) out of the completion commit and still dirty (integration test that fails on 676ed8eb27)"
  - "The test at completion-metadata-commit.test.ts:628 that mocks a save report is replaced by one on the real v2 store"
  - "The changeset no longer claims v2 staging works as prd_tree/ does on v1 unless it now does; v1 staging is unchanged"
touches:
  - "be394022-52c9-4317-ab29-8bfa26523593"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-35"
  - "hench"
  - "lane-hench"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
blockedBy:
  - "b3ae06d2-f228-46c7-9f3d-50611b28ca36"
---
