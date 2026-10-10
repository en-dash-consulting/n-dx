---
id: "243e0326-6672-46c1-806b-0dd5f0c455cd"
level: "task"
title: "Layout-literal wall misses a segmented join(root, \".ndx\", \"rex\") path"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "layout-resolver"
  - "pr-24"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A fixture line `const p = join(root, \".ndx\", \"rex\", \"prd_tree\");` is reported by findSites with its line number"
  - "The policy suite passes on the current tree, with sourcevision/src/analyzers/infrastructure.ts and llm-client/src/layout.ts still exempt"
  - "The `\".ndx/**\"` guard glob in llm-client/src/repo-trust.ts is either not matched or exempt, with the reason recorded in ALLOWED"
description: "Verdict: should-fix (low). Found by the adversarial review of task 3e16c0bb, which extended LAYOUT_LITERAL in tests/e2e/layout-literal-policy.test.js (~line 115) to match `.ndx/<tool>` and `.ndx/config*.json`.\n\nFailure scenario: production code writes `join(root, \".ndx\", \"rex\", \"prd_tree\")`, which is the usual way to build a path with `path.join`. The new alternative needs `.ndx/` and the tool name inside one literal, so neither `\".ndx\"` nor `\"rex\"` matches, and the wall passes. The legacy spelling `join(root, \".rex\", \"prd_tree\")` is caught, because a bare `\".rex\"` matches. So the segmented form is the one remaining way to hardcode the new layout. On a legacy project it fails silently, just as the `.rex/` literals did.\n\nReachability: any production file the policy scans. There is no failure today. A grep of packages/*/src finds a code-position `\".ndx\"` literal only in packages/sourcevision/src/analyzers/infrastructure.ts:63 (`join(root, \".ndx\")`), which is already in ALLOWED. packages/llm-client/src/repo-trust.ts:380 has `\".ndx/**\"`, a guard glob that a broader rule would need to tolerate.\n\nOptions:\n1. (Recommended) Match a bare `\".ndx\"` literal (option 2 in task 3e16c0bb). False positives are low on today's tree: the only hit is already allowed. `NDX_CONTAINER_DIRNAME` and `NDX_HOME_DIRNAME` (both \".ndx\") live in layout.ts, which is ALLOWED. Risk: `NDX_HOME_DIRNAME` (~/.ndx, the per-user home) is the same string with a different meaning, so a future home-dir caller would need ALLOWED or the constant.\n2. Match `\".ndx\"` only when the next argument of the same call is a tool or config name. This is more precise but needs call-shape parsing the detector does not have."
lastModified: "2026-10-10T05:35:49.248Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
