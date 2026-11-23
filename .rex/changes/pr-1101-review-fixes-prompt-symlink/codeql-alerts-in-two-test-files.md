---
id: "c7b2dc2d-3273-4b5f-b917-9f80bac0308d"
type: "task"
title: "CodeQL alerts in two test files: incomplete sanitization and useless regex escapes"
slug: "codeql-alerts-in-two-test-files"
summary: "Tidies four code-scanning warnings in tests so the security scan on the pull request is clean."
description: "CodeQL on PR #1101: packages/graview-face/tests/marks.test.ts:85 (incomplete multi-character sanitization, alert 141) and packages/web/tests/unit/viewer/button-modifier-classes.test.ts:39 (useless escapes \\., \\w, \\{{, alerts 138-140)."
acceptanceCriteria:
  - "The regexes in button-modifier-classes.test.ts carry no useless escapes and still match what they did"
  - "marks.test.ts no longer strips tags with a single-pass multi-character replace, or the alert is answered as a test-only false positive"
priority: "low"
source: "pr-review"
---
