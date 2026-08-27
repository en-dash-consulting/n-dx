---
id: "c971145e-b355-4f67-9fcb-dd37933aec1d"
level: "task"
title: "Don't skip the full test suite gate when the agent has already committed its work"
status: "pending"
priority: "medium"
tags:
  - "review-pass"
  - "e2e-finding"
  - "severity:medium"
blockedBy:
  - "976d34af-75f4-4fe3-bd74-15afed3413e9"
source: "ndx-capture"
acceptanceCriteria:
  - "A run whose changes were committed by the agent still executes the full test suite gate"
  - "The gate determines \"files modified\" against the run's startingHead rather than only uncommitted changes"
  - "The run summary's \"Changes\" line reflects files changed since startingHead, not just uncommitted ones"
  - "A regression test covers the committed-tree case"
description: "Run 60c3a951 printed:\n\n    ── Full Test Suite Gate ────────────\n               Skipped: No files modified in prior phases\n\nand \"Changes: none\" in the run summary — even though the run did change packages/llm-client/src/config.ts and its tests. The gate keys off uncommitted working-tree changes, and the executor had already committed them, so hench saw a clean tree and concluded nothing had been modified.\n\nThe effect is that a run which modified source shipped without hench's own full-suite gate ever executing. The reviewer noticed independently and ran `npm run test` itself, which is how the two red web tests surfaced at all — but that was the reviewer's initiative, not the gate doing its job.\n\nShares a root cause with the review-ordering defect (executor self-commit), so it may be fixed by the same change; keeping it separate because the gate should arguably be robust to a committed tree regardless — comparing against the run's startingHead rather than the working tree would make it so."
lastModified: "2026-08-27T16:48:34.214Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
