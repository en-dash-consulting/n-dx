---
id: "d66c59d3-bdb2-4117-ae83-f91377fa3bb6"
type: "task"
title: "architecture-policy misses computed require() in core, so extension code could be loaded in-process unflagged"
slug: "architecture-policy-misses-computed"
description: "Verdict: should-fix. The COMPUTED_IMPORT check in tests/e2e/architecture-policy.test.js matches only import(; cli.js:190 already has _require = createRequire(import.meta.url), so `_require(resolution.bin)` would load extension code in-process and pass both the computed-specifier and extension-module checks. Fix: also flag require(, _require( or any createRequire(...) call result invoked with a non-literal argument, allowlisted like COMPUTED_IMPORTS."
acceptanceCriteria:
  - "The policy test fails when packages/core calls require or a createRequire result with a non-literal specifier outside an allowlist"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
