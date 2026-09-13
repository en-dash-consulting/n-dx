---
id: "b7774208-1ba3-47b4-bcc4-177e6b7ba3aa"
level: "task"
title: "Make cross-worktree claim lifecycle tests self-contained in CI"
status: "pending"
priority: "high"
tags:
  - "pr-06"
  - "claims"
  - "ci"
  - "testing"
source: "ndx-capture"
acceptanceCriteria:
  - "The claim-refusal integration test reaches the claim decision in CI without requiring an installed Claude, Codex, or other user vendor CLI."
  - "The test proves a task already claimed by another live worktree is refused and identifies the conflicting worktree or task."
  - "The SIGINT integration test proves a claim acquired by its run is released after interruption."
  - "The focused claim-lifecycle suite and Build & Validate pass on a clean CI runner."
description: "PR #371 Build & Validate fails before its claim assertions because run-claim-lifecycle.test.ts invokes hench with the default Claude vendor, but the Claude CLI is intentionally absent in CI. Configure a deterministic test vendor/CLI or test seam so the suite proves external-worktree claim refusal and SIGINT claim release without depending on installed user credentials or vendor CLIs."
lastModified: "2026-09-13T20:13:05.969Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
