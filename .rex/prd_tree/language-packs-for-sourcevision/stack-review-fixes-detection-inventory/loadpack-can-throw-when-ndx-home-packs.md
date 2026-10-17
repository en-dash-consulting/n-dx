---
id: "6378f7e0-8212-4c90-a6d3-b35d476da556"
level: "task"
title: "loadPack can throw when `<ndx home>/packs` exists but cannot be read, breaking its never-throws contract"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "sourcevision"
  - "language-packs"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With a regular file at <ndx home>/packs and the pack not resolvable, loadPack resolves to status \"missing\" instead of rejecting"
  - "A unit test in tests/unit/language/pack-loader.test.ts covers it and fails on the current code"
description: "Verdict: should-fix (low). Introduced by commit 692802362.\n\nDefect: `versionInSiblingPackDir` (packages/sourcevision/src/language/pack-loader.ts) calls `readdirSync(root)` after only an `existsSync` guard. If `<ndx home>/packs` exists but cannot be listed (EACCES, or the path is a file and so ENOTDIR), readdirSync throws. The throw happens inside loadPack's resolution catch block, so loadPack rejects. Its doc and sourcevision's AGENTS.md promise that it never throws and that analysis never fails on a pack. A missing opt-in pack would then crash `sv analyze` / `ndx analyze` in the imports phase instead of producing a notice.\n\nReachability: low. It needs a pack root the user cannot read, or a file where the directory should be.\n\nOptions:\n1. (Recommended) Treat a failed readdir as \"no other version found\". Use `readdirSync` inside a narrow check: test statSync(root).isDirectory() and access(R_OK) before the call, or a try that returns undefined with a comment saying an unreadable pack root means no stale copy can be shown. Add a unit test that puts a file at `<ndx home>/packs`. Cost: a few lines."
lastModified: "2026-10-17T06:27:15.040Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
