---
id: "163ae23d-7ae6-49b5-8262-3a4d44c124e8"
level: "task"
title: "rex usage ignores .n-dx.json rex overrides: token-store passes the wrong dir and key to loadProjectOverrides"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "loadTokenUsageConfig applies rex.budget from .n-dx.json next to the .rex directory"
  - "A unit test writes .n-dx.json with rex.budget in a temp project and asserts the merged config; it fails on the current code"
description: "Verdict: out-of-scope (pre-existing; found while reviewing PR 12 placement settings).\n\npackages/rex/src/core/token-store.ts:21 calls loadProjectOverrides(dirname(rexDir), PROJECT_DIRS.REX). loadProjectOverrides expects the package config dir (it takes dirname itself) and the section key \"rex\"; this passes the project dir (so it reads the parent of the project) and the key \".rex\". Scenario: .n-dx.json { \"rex\": { \"budget\": { ... } } } -> loadTokenUsageConfig returns only .rex/config.json values; budget overrides from .n-dx.json are silently ignored by `rex usage` / token-format.\n\nFix: loadProjectOverrides(rexDir, \"rex\") (as file-adapter.ts and core/placement-policy.ts do), plus a test with a temp project. Cheap, low risk."
lastModified: "2026-10-07T22:22:00.907Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
