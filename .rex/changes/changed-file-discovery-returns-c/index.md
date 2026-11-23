---
id: "693686e9-6506-44a6-9589-da7a63e28f49"
type: "change"
title: "Changed-file discovery returns C-quoted paths for non-ASCII file names"
slug: "changed-file-discovery-returns-c"
summary: "When a file name has accented or non-Latin characters, hench reads it back from git in an escaped form that names no real file, so its post-task checks quietly skip that file."
intent: "Severity: medium. Verdict: out-of-scope (pre-existing; surfaced by ndx-adversarial-review of task 605dd17e \"PHP guard defaults for hench\").\n\nScenario: the agent changes `src/café.php`. `discoverChangedFiles` (packages/hench/src/validation/changed-files.ts:185) runs `git diff --name-only <base>` and `git status --porcelain` without `-z` or `-c core.quotepath=false`. With git's default core.quotepath=true the line is `\"src/caf\\303\\251.php\"`, which is stored as-is in run.structuredSummary.filesChanged. Every consumer that stats join(projectDir, path) finds nothing: the PHP guards (packages/hench/src/tools/php-guards.ts) skip linting that file, so a broken file passes; test scoping (findRelevantTests) misses its co-located tests.\n\nReachable: any run (ndx work) whose change touches a file with a non-ASCII name.\n\nOptions:\n1. Recommended: pass `-c core.quotepath=false` (or use `-z` and split on NUL) in both git calls of discoverChangedFiles. Small, contained, and testable with a fixture repo.\n2. Unquote C-style git paths after the fact. More code, and easy to get wrong."
acceptanceCriteria:
  - "discoverChangedFiles returns src/café.php (unescaped) for a tracked change and for an untracked file in a fixture repo"
  - "A test in hench's validation tests fails against the current code and passes after the fix"
touches:
  - "4ceadf67-034a-4052-8e0f-af2d9ff097f4"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "hench"
source: "ndx-adversarial-review"
---
