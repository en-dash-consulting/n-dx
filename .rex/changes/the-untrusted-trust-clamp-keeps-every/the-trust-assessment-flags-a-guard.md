---
id: "d17bd9c5-6b58-4e8c-9a80-01d2bd73d828"
type: "task"
title: "The trust assessment flags a guard that drops its own ecosystem's dependency directory"
slug: "the-trust-assessment-flags-a-guard"
description: "Hal's adversarial review of #816 (diff mode, origin/main...fix/security-repo-trust), posted 2026-10-20: https://github.com/en-dash-consulting/n-dx/pull/816, finding F2 (medium, pre-existing, out-of-scope in the review):\n\n> `blocked-paths-removed` (`:511`) checks only `[\"hench\", \"rex\", \".git\"]`. Nothing compares the repo's `blockedPaths` to the baseline's `extraBlocked`. Combined with `restricted: state === \"untrusted\" || state === \"changed\"` (`:792`), a repo whose guard omits `node_modules/**` and raises no other warning stays `baseline` → not restricted → **the clamp never runs** → the block is simply absent, in every language. Predates this change; reporting it separately rather than attaching it.\n\nHal notes F1's fix \"closes it too\"; it does not on its own, because the clamp only runs on a restricted checkout. So the assessment itself reports the omission. Scope it to the detected ecosystem's directories (`node_modules/**` for JS/TS, `vendor/**` for Go, the Swift set for Swift): those are what `ndx init` has always written for that language, so a legitimately initialized repository raises nothing new. Flagging every ecosystem's directories would turn every repository initialized before the F1 fix untrusted on upgrade.\n\nCaptured with Ryan's approval on 2026-10-27."
acceptanceCriteria:
  - "Closes #686 (finding 1, follow-up): a repository guard that drops its own ecosystem's dependency directory needs trust"
  - "blocked-paths-removed (or a sibling finding, at warning severity) reports a guard whose blockedPaths omit the detected language's extraBlocked entries, naming them"
  - "Test: a JS/TS checkout whose .hench/config.json guard omits node_modules/** and has no other deviation evaluates untrusted with that finding; the test fails on the code before the fix"
  - "Test: a guard that ndx init writes for each language raises no such finding, and this repository's own .hench/config.json stays at its current trust state"
priority: "medium"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
