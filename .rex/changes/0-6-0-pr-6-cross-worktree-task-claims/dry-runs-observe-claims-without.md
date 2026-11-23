---
id: "e02571f1-877e-40d5-8ad7-60d68dff71bd"
type: "task"
title: "Dry runs observe claims without writing one"
slug: "dry-runs-observe-claims-without"
description: "The claim is taken in assembleTaskBrief, which runs before the dry-run branch in both cliLoop and agentLoop — so `--dry-run` wrote a real claim for a run that does no work. The claim was released in runOne's finally, so nothing leaked, but during the preview a dry run in one worktree could refuse a genuine run starting in another, and every preview churned the claims file under its lock.\n\nTaskClaims now takes a readOnly flag, set from dryRun. In that mode claim() answers the question the caller is really asking — would a real run be refused? — by reading isClaimedByOther, and records nothing. A preview still reports a task held elsewhere, which is faithful to what a real run would meet, and still passes over foreign claims during autoselect, because that path only reads."
acceptanceCriteria:
  - "A dry run that selects a free task leaves no claim: another worktree still sees the task as free."
  - "A dry run is still told when a task is held elsewhere."
  - "Read-only mode holds nothing, so startRenewal and renewNow are no-ops."
priority: "medium"
tags:
  - "pr-06"
  - "hench"
source: "PR 371 review, 2026-09-17 — carried over after that branch was closed as superseded"
---
