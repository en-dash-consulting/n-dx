---
id: "9ffe3e1c-d192-4bea-a117-c646e28cac53"
level: "feature"
title: "Git-Safety Hardening: express-prompt destructive actions and size-aware commit checkpoints"
status: "completed"
priority: "high"
startedAt: "2026-07-17T18:11:46.449Z"
completedAt: "2026-07-17T18:11:46.449Z"
endedAt: "2026-07-17T18:11:46.449Z"
acceptanceCriteria: []
description: "Close three gaps found while reviewing the #279 pre-run commit gate and the ndx init git preflight. Goal: no destructive git action (rollback/reset/checkout/clean) happens without being expressly prompted, and commit checkpoints escalate based on how large the uncommitted changes are — all enforced programmatically.\n\nRelated existing work in this epic: 'Pre-run commit gate' {9af68a23}, 'Run Failure Recovery and Rollback' {3415b5f0}, 'Ctrl-C Interrupt Rollback Prompt Coordination' {469c7900}, 'Commit Approval Bypass for Autonomous Runs' {3ca4d0d8}.\n\nContains three independent tasks, one per gap."
---

## Children

| Title | Status |
|-------|--------|
| [Add change-magnitude threshold and config to the pre-run commit gate](./add-change-magnitude-threshold-cec156.md) | completed |
| [Enforce the git-subcommand allowlist in CLI provider mode (default), not just API mode](./enforce-the-git-subcommand-e76192.md) | completed |
| [Gate rollbackOnFailure reverts behind an express prompt in interactive runs](./gate-rollbackonfailure-reverts-5aa0a3.md) | completed |
