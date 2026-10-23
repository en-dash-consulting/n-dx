---
id: "9481cf19-1ef7-41ff-a557-56031973ce68"
type: "task"
title: "The error-message and wall-clock policy detectors see the spellings they forbid"
slug: "the-error-message-and-wall-clock"
description: "Two policy tests have blind spots the stack #855 reviews found. packages/web/tests/integration/error-message-policy.test.ts flags String(err|e|error) in a response argument but not String(e as Error), a template literal ${err}, err.toString(), another catch-variable name (cause, exc) or a ternary wrapped across lines (rule 2 is per-line). tests/e2e/wall-clock-inventory-policy.test.js requires a duration word in the expect subject, so expect(performance.now() - start).toBeLessThan(n) is invisible, which is exactly how layer 6's first cut slipped past. Widen both, with detector self-tests for each new spelling; keep the response-argument scan scoped to the caught value so String(count) formatting is not flagged."
acceptanceCriteria:
  - "Each listed spelling planted in a probe file fails the matching policy test and is removed again"
  - "Both policy tests still pass on the real tree"
priority: "low"
source: "codeql-triage"
---
