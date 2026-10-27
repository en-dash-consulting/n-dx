---
id: "9ffe3e1c-d192-4bea-a117-c646e28cac53"
type: "change"
title: "Git-Safety Hardening: express-prompt destructive actions and size-aware commit checkpoints"
slug: "git-safety-hardening-express-prompt"
intent: "Close three gaps found while reviewing the #279 pre-run commit gate and the ndx init git preflight. Goal: no destructive git action (rollback/reset/checkout/clean) happens without being expressly prompted, and commit checkpoints escalate based on how large the uncommitted changes are — all enforced programmatically.\n\nRelated existing work in this epic: 'Pre-run commit gate' {9af68a23}, 'Run Failure Recovery and Rollback' {3415b5f0}, 'Ctrl-C Interrupt Rollback Prompt Coordination' {469c7900}, 'Commit Approval Bypass for Autonomous Runs' {3ca4d0d8}.\n\nContains three independent tasks, one per gap."
touches:
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
priority: "high"
---
