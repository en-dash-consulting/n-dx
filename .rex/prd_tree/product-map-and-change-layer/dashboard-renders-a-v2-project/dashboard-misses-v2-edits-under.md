---
id: "aeac2c3a-8d85-4c5f-904d-a0094eb2a0e8"
level: "task"
title: "Dashboard misses v2 edits under changes/ when it was created after ndx start"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-36"
  - "web"
blockedBy:
  - "8e5fab27-da11-4b09-ade5-a81ddbc539bc"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With the server watching a v2 rexDir that has no changes/ directory, creating changes/<slug>/index.md refreshes .rex/.cache/prd.json without a restart"
  - "A test drives registerRexWatcher (or its extracted helper) on a v2 temp tree and fails against 37f5f63bc"
description: "Verdict: should-fix (adversarial review of 37f5f63bc). In registerRexWatcher (packages/web/src/server/start.ts), each PRD folder (prd_tree, product, changes) gets a recursive watch only if it exists at boot. rex's v2 writer (prd-model-writer.ts:172) creates changes/ only once the first change exists. Scenario: a v2 project with no changes yet runs `ndx start`, then an MCP add_item or CLI write creates changes/<slug>/. Nothing watches changes/ and the .rex watcher ignores the new entry, so .rex/.cache/prd.json stays stale and the task list and Live miss the change until restart. Dashboard routes are unaffected because they call refreshPRDCache themselves. Reachable through any non-dashboard writer on a freshly bootstrapped v2 tree.\n\nOptions:\n(a) Recommended. The non-recursive rexDir watcher also reacts to filename \"product\" or \"changes\": it refreshes, and lazily adds the recursive watch when the directory appears. Small, and it keeps the watcher list owned by registerRexWatcher.\n(b) Watch rexDir recursively on v2. Simpler, but it fires on .cache/ writes (the refresh's own output), which would loop."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T11:19:03.654Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
