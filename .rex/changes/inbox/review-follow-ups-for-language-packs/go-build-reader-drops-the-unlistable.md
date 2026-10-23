---
id: "e233ea3f-f8d5-45b7-9b23-612e02c85c7b"
type: "task"
title: "Go build reader drops the unlistable-directory notice when no go.mod or go.work is found"
slug: "go-build-reader-drops-the-unlistable"
description: "Verdict: should-fix (low). packages/sourcevision/src/language/go-build.ts readGoBuildModels / readGoWorkFiles attach directory-walk notices to the first model or go.work file (`if (out.length > 0) out[0] = …`). When nothing was found, the notices are dropped. Scenario: a repository whose only go.mod sits inside a chmod 000 directory → readGoBuildModels(projectDir) returns [] with no notice, which looks exactly like \"not a Go module\". Also, readGoProject (go-resolver.ts) never surfaces any model notices, so even attached notices reach no user yet. Reachability: not wired into analyze until 'Switch Go import edges' lands. Options: (1) return walk notices alongside the models, e.g. a readGoProject-level `notices` field (changes an internal signature, cheap; recommended, and do it together with the switch task so notices reach analyze output); (2) synthesize a placeholder model carrying the notice - rejected, since it invents a module."
acceptanceCriteria:
  - "readGoBuildModels or readGoProject on a tree whose only go.mod is inside an unlistable directory reports that directory as a notice"
  - "readGoWorkFiles on a tree whose only go.work is inside an unlistable directory reports that directory as a notice"
  - "A unit test in tests/unit/language/go-build.test.ts covers the no-model case (skipped on Windows and as root)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "go"
source: "ndx-adversarial-review"
---
