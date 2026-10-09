---
id: "8405e8d9-ebb3-450a-96da-d5938efd8456"
level: "task"
title: "The merge-state git test's LF pin is unguarded off Windows: removing it still passes on macOS and Linux"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On macOS/Linux, the conflict test fails when `text eol=lf` is removed from the fixture's .gitattributes"
  - "With the pin present, the conflict test still passes on every OS and still asserts LF conflict markers without stripping \\r"
  - "The other tests in merge-state-git.test.ts still pass unchanged"
description: "Verdict: should-fix (medium).\n\nScenario: in packages/rex/tests/integration/merge-state-git.test.ts:79-87 the fixture's .gitattributes now pins `.rex/product/**/state.yaml text eol=lf merge=rex-state` (commit f6d538856). If someone drops `text eol=lf`, the conflict test still passes on macOS, Linux and local runs, because only GitHub's Windows runners set core.autocrlf=true. Only the Windows CI job catches it.\n\nReachability: any edit to the fixture. The Windows job is the only guard, and hench's test gate never runs it.\n\nOptions:\n(a) Recommended: set `git config core.autocrlf true` in the conflict test only, so it reproduces Windows conditions on every OS. Costs one line. Risk: index.md has no pin in the fixture, so its checkouts would become CRLF; the clean-merge test that reads index.md must stay unaffected, which is why the setting belongs in the conflict test only.\n(b) Also pin `.rex/**/*.md text eol=lf` to match ndx init, then set autocrlf for every test. This mirrors init more fully but widens the change."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-09T14:52:34.967Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
