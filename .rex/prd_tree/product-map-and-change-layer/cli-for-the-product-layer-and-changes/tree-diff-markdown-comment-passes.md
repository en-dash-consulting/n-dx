---
id: "80774f33-c3b7-4d2f-8053-5aafa2081168"
level: "task"
title: "tree-diff Markdown comment passes @mentions in titles through, so posting it pings users and teams"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-18"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A title containing @user or @org/team renders in the Markdown comment without a sequence a code host parses as a mention"
  - "A unit test in tests/unit/core/map-diff.test.ts covers a title containing @org/team and fails on the current text() escaping"
description: "Scenario: a capability or work item titled \"Notify @infra/oncall on failure\" appears in `rex tree-diff --format=markdown`. `text()` in packages/rex/src/core/tree-diff-markdown.ts escapes CommonMark specials but not `@`, so a CI that posts the comment on GitHub (or Bitbucket) pings that team. The module doc says the output has no host markers (no mentions). Issue refs such as `#123` are already escaped.\n\nReachable: any CI step posting the comment. Verdict: should-fix (low). This change introduced it, and the PR comment is new in PR 18.\n\nOptions:\n(a) Put a zero-width joiner after `@` in `text()`. It is cheap and keeps titles readable, but copy-paste picks up the invisible character.\n(b) Wrap titles in inline code. It is robust, but every title renders monospaced.\nRecommend (a).\n\nChosen (overnight 2026-10-09, reversible): option (a). A zero-width joiner after @ in text()."
lastModified: "2026-10-09T08:01:13.022Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
