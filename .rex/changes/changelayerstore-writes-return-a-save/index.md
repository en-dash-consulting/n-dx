---
id: "b3ae06d2-f228-46c7-9f3d-50611b28ca36"
type: "change"
title: "ChangeLayerStore writes return a save report of the paths written and deleted"
slug: "changelayerstore-writes-return-a-save"
intent: "Review 2026-10-12, PR #692 should-fix 2 (1672bb20, CONFIRMED by trace), rex half. Decision S1-Q3 (Ryan, 2026-10-12): in this round. 1672bb20 itself was filed in PR 35 and does not exist on this branch; it stays in PR 35 as the hench half (B1-2), blocked by this task.\n\nDefect: ChangeLayerStore (packages/rex/src/store/change-layer-store.ts) has no takeSaveFileReport, so hench's commitPrdTreeIfStaged (packages/hench/src/agent/lifecycle/shared.ts:2406-2420, 4267) gets null and falls back to staging the wholesale roots, which on v2 are <rexDir>/product and <rexDir>/changes.\n\nFailure scenario: within one worktree, any change-layer write made while an `ndx work` loop runs lands in \"chore(prd): commit PRD tree changes (task X completed)\" under task X's N-DX-Item trailer: a dashboard Quick Add or status PATCH (PR 36 adds both), or a hand edit. The pre-run gate discounts those paths, so nothing warns. Nothing is lost; it is misattribution, the hazard WM2040 fixed on v1. The concurrency contract marks `ndx start` + `ndx work` as safe, and this repository runs both daily, so it blocks the cut (not the merge).\n\nFix: the v2 transaction (withPrdModelTransaction / the writer it uses) records the files each write created, rewrote and deleted under product/ and changes/, and ChangeLayerStore exposes them through takeSaveFileReport with the same shape and take-once semantics FileStore's report has, so hench's existing scoping accepts them unchanged. completeV2Work's writes (task, change, product apply) must be reported too, whichever store instance hench passes."
acceptanceCriteria:
  - "After a ChangeLayerStore write on a v2 copy, takeSaveFileReport returns exactly the product/ and changes/ paths written and deleted, and a second call returns null (test that fails on 1ea7984bfb)"
  - "completeV2Work's completion and apply writes appear in the report, including product/ files the apply touched (test)"
  - "FileStore's save report on v1 is unchanged; existing tests pass unedited"
touches:
  - "b86f9199-bd84-45e8-95a8-bad39e42ebeb"
priority: "medium"
tags:
  - "pr-34"
  - "review-2026-10-12"
  - "lane-rex-domain"
source: "review-2026-10-12"
---
