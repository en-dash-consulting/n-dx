---
id: "ad4abaa9-cb9f-45c3-8882-6e49e334dc17"
type: "change"
title: "v2 isolation test does not detect imports of the store transaction from outside the v2 set"
slug: "v2-isolation-test-does-not-detect"
intent: "Verdict: should-fix (low). Found by adversarial review of d3c20225.\n\nFailure scenario: a runtime module outside the v2 set (say src/cli/commands/foo.ts) adds `import { withPrdModelTransaction } from \"../../store/prd-model-transaction.js\"`. The isolation test in packages/rex/tests/unit/schema/v2.test.ts (~line 459) still passes. Its `v2Import` regex only matches schema/v2, schema/v2-rules, state-writer and prd-model-(reader|writer), so it never matches prd-model-transaction. The comment above v2Files says nothing outside the set may import the v2 modules, and that now includes the store transaction, but nothing enforces it. A premature caller would reach the v2 write path without failing any test.\n\nReachability: a future edit only. Today no module outside the set imports the transaction (only prd-model-writer.ts mentions it, in a comment).\n\nOptions:\n(a) Widen the regex group to `prd-model-(?:reader|writer|transaction)`. One line, no risk. Recommended.\n(b) Leave it for PR 17, which turns this test into an allowlist of wired callers. Free, but the gap stays open until PR 17 lands.\n\nTask d3c20225 deliberately limited itself to the v2Files entry, which is why this was not fixed there."
acceptanceCriteria:
  - "The v2 isolation test in packages/rex/tests/unit/schema/v2.test.ts reports a non-v2 src module that imports store/prd-model-transaction(.js) as an offender"
  - "The isolation test still passes on the current tree, where only v2-set modules reference the transaction"
touches:
  - "abd05895-1b96-4798-bfb8-8e4b66fca049"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-31"
  - "rex"
source: "ndx-adversarial-review"
---
