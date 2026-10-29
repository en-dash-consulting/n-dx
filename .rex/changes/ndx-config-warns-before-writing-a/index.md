---
id: "82c94fef-c163-464a-92bd-e081fc92c852"
type: "change"
title: "ndx config warns before writing a secret into a committed .n-dx.local.json"
slug: "ndx-config-warns-before-writing-a"
intent: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding K (low, should-fix; out-of-scope (pre-existing), its own change).\n\nFailure scenario: in a repository that commits .n-dx.local.json, `ndx config llm.claude.api_key <key>` (packages/core/config.js around 3084-3135) writes the key into that tracked file with no warning, so the next commit publishes it. A cli_path set the same way is then silently trust-gated, because a tracked local file is repository config.\n\nProbed: git status showed the tracked file modified after the write; no warning printed.\n\nOption: check the file's tracked state (the shared helper from the stack's finding A) before writing; refuse a secret-shaped key with an explanation, and warn for any other key that the value will be shared and gated."
acceptanceCriteria:
  - "ndx config refuses to write a credential into a git-tracked .n-dx.local.json and says why, without printing the value"
  - "Writing any other key into a tracked local file warns that the file is repository config"
  - "Test: both behaviours in a temp git repo; the test fails on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"82468601-c666-4943-a9ac-b11bb0149372"}
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
