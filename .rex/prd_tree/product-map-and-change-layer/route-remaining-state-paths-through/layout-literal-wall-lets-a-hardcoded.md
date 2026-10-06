---
id: "3e16c0bb-a2c7-4524-aae0-f2e22a1e312f"
level: "task"
title: "Layout-literal wall lets a hardcoded .ndx/rex, .ndx/hench or .ndx/sourcevision path through"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "layout-resolver"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A fixture line `const p = join(root, \".ndx/rex/prd_tree\");` is reported by the layout-literal policy detector as a wall violation with its line number."
  - "A fixture line `const c = \".ndx/config.json\";` is reported as a violation."
  - "packages/web/src/viewer/state-paths.ts and packages/llm-client/src/layout.ts remain exempt and the policy suite passes on the current tree."
description: "Verdict: should-fix (low). Found reviewing task 9a09a196, which turned the directory half of tests/e2e/layout-literal-policy.test.js into a wall.\n\nFailure scenario: a contributor writes `join(root, \".ndx/rex/prd_tree\")` (or `\".ndx/config.json\"`) in production code. LAYOUT_LITERAL only matches literals that *start* with `.rex`, `.hench`, `.sourcevision` or `.n-dx*`, so the wall passes. On a legacy-layout project that path does not exist, and the read fails as silently as the `.rex/` literals the rule was written to stop — the same decision taken a second time, just spelled for the other layout.\n\nEvidence: tests/e2e/layout-literal-policy.test.js, `LAYOUT_LITERAL` and `DIRECTORY_LITERAL`. A grep of packages/*/src today finds `.ndx/<tool>` string literals only in packages/web/src/viewer/state-paths.ts, which is already in ALLOWED — so there is no current failure; this makes the next change riskier.\n\nReachability: any production file the policy scans. Pre-existing in the detector since #450; made more consequential by 9a09a196 advertising the rule as a wall.\n\nOptions:\n1. (Recommended) Extend LAYOUT_LITERAL with `\\.ndx\\/(?:rex|hench|sourcevision|config(?:\\.local)?\\.json|web[^\"'`\\s]*)` and route those matches into the directory/wall half (config ones into the wall too, since no `.ndx/config.json` debt exists). Cheap; existing ALLOWED entries already cover the resolver and twins. Risk: may surface prose-in-string sites, which the whitespace rule already excludes.\n2. Match a bare `\".ndx\"` too. Broader, but `NDX_CONTAINER_DIRNAME` is the only legitimate spelling and lives in layout.ts — higher false-positive risk for little gain."
lastModified: "2026-10-06T06:58:31.649Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
