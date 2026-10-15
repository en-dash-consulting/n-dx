---
id: "349cf1aa-cd90-4dd1-aaa3-0525ba5a0f88"
level: "task"
title: "ndx install-sample writes a v1 prd_tree/ beside a fresh v2 product/"
status: "pending"
priority: "medium"
tags:
  - "core"
  - "lane-migration"
blockedBy:
  - "ff12092b-d386-46b4-b344-8ccf22a338ba"
acceptanceCriteria:
  - "install-sample on a v2 project adds a change with two tasks and creates no prd_tree/"
  - "destroy-sample removes them"
  - "install-sample on a v1 project behaves as before"
description: "packages/core/sample-app.js handleInstallSample hand-writes an epic/feature/two tasks into <rexDir>/prd_tree/. Since ff12092b a freshly initialised project is v2, so install-sample now creates a split tree (product/ plus prd_tree/), which v2 reads ignore and v1 tools read as the PRD. Same for handleDestroySample and command-effects.js (\"{rex}/prd_tree/sample-app-improvements/\"). Write the sample as a v2 change with tasks (through rex add, or the rex public API) on a v2 tree, and keep the v1 path for a v1 tree."
lastModified: "2026-10-15T23:45:33.397Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
