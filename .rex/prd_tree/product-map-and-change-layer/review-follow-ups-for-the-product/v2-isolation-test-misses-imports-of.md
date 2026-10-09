---
id: "c75b557e-f70c-4fe3-b5ad-d85516be4dbd"
level: "task"
title: "v2 isolation test misses imports of the core v2 modules and dynamic import() of any v2 module"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-31"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The v2 isolation test reports a non-v2 src module that statically imports any module in v2Files (e.g. core/apply-amendments.js) as an offender"
  - "The v2 isolation test reports a non-v2 src module that dynamically imports a v2Files module via import() as an offender"
  - "The isolation test still passes on the current tree"
description: "Verdict: out-of-scope (pre-existing, low). Found by adversarial review of ad4abaa9.\n\nFailure scenario: the `v2Import` regex in packages/rex/tests/unit/schema/v2.test.ts (~line 459) only matches static `from \"…\"` specifiers for schema/v2(-rules), state-writer and prd-model-(reader|writer|transaction). A non-v2 src module that adds `import { applyAmendments } from \"../core/apply-amendments.js\"` (or any other core/* v2-set module: apply-policy, product-edit, product-edges, product-status, change-landing, placement(-policy), change-selection, change-completion, codeowners/plan) passes the test. So does `await import(\"../store/prd-model-transaction.js\")`. Verified with node against the regex: both return false.\n\nReachability: a future edit only; no current offender.\n\nOptions:\n(a) Derive the pattern from v2Files itself: match any import specifier (static `from`, side-effect `import \"…\"`, and `import(…)`) whose resolved path is in v2Files. Removes the hand-maintained regex that drifts from the set. Small, test-only. Recommended.\n(b) Leave for PR 17, which turns the test into an allowlist of wired callers; fold (a) into that rewrite."
lastModified: "2026-10-08T21:46:34.202Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
