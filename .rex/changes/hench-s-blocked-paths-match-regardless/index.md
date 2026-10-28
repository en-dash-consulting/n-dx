---
id: "3f20dfd1-cf9d-48ba-a01f-c147f6ae65b1"
type: "change"
title: "hench's blocked paths match regardless of case and through symlinks"
slug: "hench-s-blocked-paths-match-regardless"
intent: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding D (high, should-fix; out-of-scope (pre-existing), its own change).\n\nFailure scenario: packages/hench/src/guard/paths.ts:49-125 matches blockedPaths case-sensitively against the path as written. On a case-insensitive filesystem the guard allows `.Git/hooks/pre-commit`, `.HENCH/config.json`, `.ENV` and `NODE_MODULES/x/index.js`; with a committed symlink `docs -> .git` it allows `docs/hooks/pre-commit`. The untrusted clamp's blocked paths therefore do not stop the agent planting a git hook, which runs at the operator's next commit with their full environment.\n\nProbed: each of those writes was ALLOWED by validatePath against the baseline guard.\n\nOptions: resolve the target (or its deepest existing parent) with realpath before matching, and match case-insensitively where the filesystem is; or both, always. Recommended: both, always: a false block on a case-sensitive filesystem costs far less than a planted hook."
acceptanceCriteria:
  - "A write whose real path falls under a blocked pattern is refused whatever case it is spelled in and however many symlinks it goes through"
  - "Test: .Git/hooks/x, .HENCH/config.json and a write through a symlink into .git are refused; the tests fail on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"82468601-c666-4943-a9ac-b11bb0149372"}
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
