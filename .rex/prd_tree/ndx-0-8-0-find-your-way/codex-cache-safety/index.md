---
id: "2213c02b-5060-4f8f-80f1-15999102f45c"
level: "feature"
title: "Codex cache safety"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "codex-cache-safety"
source: "caos work management: feature ndx 0.8.0 - Codex cache safety"
acceptanceCriteria:
  - "A chain created in one worktree cannot resume in another (test)."
  - "Every rejection reason has a stable machine-readable code and a unit test."
  - "Users can list and clear cache entries for a scope without editing JSON."
  - "Every run record reports strategy and decision reason, and Codex cache data shows measured, estimated or unavailable, never zero for unknown."
  - "The contract tests run in CI without credentials."
description: "Codex session reuse today tracks only vendor, model, task count and last task title, so a resumed chain can belong to another worktree, branch, source state or prompt policy. Before wider use: version the batch-cache entry and key it by worktree, branch or revision, source fingerprint, policy hash, vendor, model, creation and last-use time and a TTL, so any mismatch produces a named miss; add scoped list and clear controls with automatic eviction of expired, failed and malformed entries, never persisting prompt content; record on every run which strategy was used, the hit or miss reason, session age, and whether token data is measured, estimated or unavailable, and summarise it in the CLI and dashboard; add deterministic contract tests proving an eligible chain resumes exactly once with the expected arguments and an unsafe chain never reaches the spawned command. Bias toward a false miss over a wrong hit.\n\nGoal: Codex resume is a tested contract that can never continue a session built for a different worktree or source state."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add deterministic contract tests for Codex session resume that run in CI without credentials](./add-deterministic-contract-tests-for.md) | pending |
| [Add scoped list and clear for Codex cache entries with automatic eviction](./add-scoped-list-and-clear-for-codex.md) | pending |
| [Record the session strategy, hit or miss reason and token-data provenance on every run](./record-the-session-strategy-hit-or.md) | pending |
| [Version the Codex batch-cache entry and key it by worktree, revision, source fingerprint and policy](./version-the-codex-batch-cache-entry.md) | completed |
