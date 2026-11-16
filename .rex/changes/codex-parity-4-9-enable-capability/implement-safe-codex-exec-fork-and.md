---
id: "f40ce379-f90a-4809-bc7f-fd54b6dc6e8e"
type: "task"
title: "Implement safe Codex exec fork and warm-parent task strategy"
slug: "implement-safe-codex-exec-fork-and"
description: "Use the actual chosen binary's capability/version, not the existence of a generic codex on PATH. Official reference: https://learn.chatgpt.com/docs/developer-commands . Audit help advertised fork; no successful live fork was tested.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Capability/version-gated exec fork creates a new session ID while preserving the parent's transcript."
  - "Warm-parent tasks inherit orientation without appending to or mutating the shared parent."
  - "Fresh/forked turns reapply sandbox, approvals, model and credential isolation; identity/policy changes invalidate cached reuse."
  - "Unsupported or unavailable versions fall back with an explanation; test real supported CLI behavior separately from mocked argv."
  - "Preserve existing batch/cold strategies and their worktree/branch/source/policy freshness contracts."
priority: "medium"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR4 only. High correctness risk: session identity, immutable shared orientation parent, policy/credential boundaries and cache freshness. Assign heavy Astra execution and mandatory fresh heavy Astra Codex self-review; fixture/protocol tests plus separately labelled installed CLI fork evidence. Current authorization supersedes capture-only historical prose. No PR5-9 implementation or unrelated capture. Do not spawn subagents or nested reviews: Hench launches the required fresh review. Preserve batch/cold behavior, worktree/branch/source/policy freshness and all intentional model pins. Read .claude/skills/ndx-release-notes/SKILL.md before writing scoped patch changesets. Use required cli-dev/scheduler-startup checks and scoped builds/typechecks, mandatory affected gate; never full-suite duplication or --no-slot. Live fork checks must retain workspace-write/approval never and credential isolation; do not bypass confinement. Do not claim help output as successful fork. Complete only this task through Hench sentinel/atomic commit; no direct task completion or source implementation by coordinator."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-4"
source: "ndx-capture"
blockedBy:
  - "2331ee7c-5a4b-488e-8cab-82d4fe1506dc"
---
