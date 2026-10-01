---
id: "fae050a6-3173-4c80-939b-cae680307c29"
level: "epic"
title: "Hotfix · #473 forked task sessions refuse to edit"
status: "pending"
priority: "high"
tags:
  - "hotfix"
  - "hench"
  - "bug"
source: "ndx-capture"
description: "Fixes en-dash-consulting/n-dx#473. Under `sessionStrategy: \"fork\"` (the Claude default) every task spawn is `--resume <orientation> --fork-session`. Each spawn passes its own `--system-prompt`, so the orientation system prompt is NOT inherited. What a fork inherits is the orientation's first user turn (\"Orient yourself in this repository. Do not modify anything.\", `buildOrientationPrompt()` in packages/hench/src/agent/lifecycle/orientation.ts) and the orientation reply, which calls itself read-only. Nothing in the task prompt lifts it: the first forked attempt reuses `baseEnvelope` from `prepareBrief` unchanged (cli-loop.ts, the per-attempt envelope build). A no-change result is `completion_rejected` and breaks the run (`processSuccessfulResult`), so the next run forks the same parent again.\n\nEvidence (all in `.run-logs/` of the live-nav-item-mockups-bc0488 worktree): run 9fb66239 / task b1dd0bde forked a 26-minute-old parent and refused; run c5017ba6 / task b5092c2f forked a 55-minute-old parent and refused (\"This session's instructions say not to edit…\"); run 07eb4cad forked a 13-hour-old parent and did edit (its commit failed for the unrelated #485). So the refusal is intermittent and not tied to parent age, and the cached parent itself is not broken.\n\nA #473 failure ends with \"No changes detected in git diff\". Keep it separate from #485 (blocked `cd … && git` commits, ends with \"Refusing to mark this task completed … uncommitted\"): different code path.\n\nConventions: branch from main, not feat/live-tab. Cross-package imports go through `src/prd/llm-gateway.ts` / `rex-gateway.ts`. hench must not import node:child_process. Add a `@n-dx/hench` patch changeset (scoped name). Run `pnpm test` from the repo root before declaring done."
lastModified: "2026-10-01T21:02:20.377Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Forked task sessions know orientation is over and recover from a read-only refusal](./forked-task-sessions-know-orientation/index.md) | pending |
