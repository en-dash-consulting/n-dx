---
id: "58117c3d-c1eb-4ef0-a0da-ded997c9ebe7"
type: "task"
title: "The pair reviewer CLI keeps the user's own .n-dx.local.json guard.env.allow while the repository is untrusted"
slug: "the-pair-reviewer-cli-keeps-the-user-s"
description: "Fix for change 7106236d, found by the adversarial review of 942e0619 (run 7c30a468). applyRepoTrustToEnvPolicy (packages/core/config.js) drops the whole merged guard.env.allow list while the repository is restricted, so the user's own .n-dx.local.json entries are lost too, unlike hench's agent shell (applyRepoTrust) and repository commands (repoCommandEnv), which keep them. Fix, the review's option 1: keep the allow entries the local config file names (read hench.guard.env.allow from .n-dx.local.json, as repo-command-env's localEnvPolicy does) and drop only the rest. Kept in layer 2 by Ryan on 2026-10-27, to run last, after d59b5373."
acceptanceCriteria:
  - "Closes #686 (finding 3, follow-up): while untrusted, the pair reviewer CLI, the agent's shell and repository commands follow one rule for guard.env.allow"
  - "In an untrusted checkout, a variable named in .n-dx.local.json hench.guard.env.allow reaches the reviewer CLI environment (test asserts presence only)"
  - "A repository-supplied guard.env.allow entry still does not reach it while untrusted"
  - "The once-per-dir warning names only the dropped repository entries"
  - "Test fails on the code before the fix"
priority: "low"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
