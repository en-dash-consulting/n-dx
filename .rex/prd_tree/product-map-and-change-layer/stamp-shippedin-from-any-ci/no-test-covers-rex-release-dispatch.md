---
id: "a933df4f-853b-4041-8ebe-f380f821ed07"
level: "task"
title: "No test covers rex release dispatch through the CLI entry, so the v1 never-fail path can regress unseen"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test spawns the built rex CLI with `release stamp 1.0.0` (no dir) in a v1 project and asserts exit 0 and the v1 message"
  - "A test spawns `rex release stamp 1.0.0 <dir>` where <dir> has no rex directory and asserts exit 0 and the no-rex-directory message"
  - "Removing \"release\" from SKIP_DIR_CHECK makes the tests fail"
description: "Verdict: should-fix (low). Found by adversarial review of task 2f427fb8.\n\nThe v1/no-rex-directory no-op depends on two lines in packages/rex/src/cli/index.ts: \"release\" in SKIP_DIR_CHECK and `resolveDir(positional.slice(2))`. The integration tests call cmdRelease in-process and bypass both. If either line regresses, `rex release stamp 0.9.0` (no dir) resolves \"0.9.0\" as the project dir and requireRexDir throws \"Rex directory not found\", and a project with no .rex fails the same way. The release workflow fails open, so the regression would surface only as a warning line in CI. Verified manually that both cases currently print \"Nothing to stamp\" and exit 0.\n\nOption (recommended): an e2e test spawning the built rex CLI for `release stamp 1.0.0` with no dir in a v1 checkout and with an explicit dir lacking .rex, asserting exit 0 and the one-line message. Cost: one small test. Risk: none."
lastModified: "2026-10-09T06:23:12.717Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
