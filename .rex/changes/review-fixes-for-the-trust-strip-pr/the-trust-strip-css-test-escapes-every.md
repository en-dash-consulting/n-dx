---
id: "421688bd-3b79-49b0-b979-b4143026b032"
type: "task"
title: "The trust strip CSS test escapes every regex metacharacter in its selector"
slug: "the-trust-strip-css-test-escapes-every"
description: "CodeQL \"Incomplete string escaping or encoding\" on #1013 (code scanning alert 118) at packages/web/tests/unit/viewer/repo-trust-css.test.ts:12: `rule(selector)` builds a RegExp from the selector with `selector.replace(/\\./g, \"\\\\.\")`, which escapes dots but not backslashes or the other metacharacters. Fix it properly, don't dismiss the alert: escape the whole set, e.g. `selector.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\")` (backslash included). If the web tests already share an escape helper (search packages/web/tests and packages/web/src for escapeRegExp / escapeRegex), use it instead of a new copy; otherwise keep the helper local to the test. The test's assertions stay as they are and keep passing. A small self-check in the same file is welcome: rule() finds a selector containing a metacharacter only literally. Run that test file and the other viewer stylesheet tests that use the same pattern if any (grep for `replace(/\\\\./g` under packages/web/tests and fix those too). No changeset is needed for a test-only change."
acceptanceCriteria:
  - "repo-trust-css.test.ts escapes the full regex metacharacter set, backslash included, and still passes"
  - "No other web stylesheet test builds a RegExp from a selector by escaping dots only"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
