---
id: "5aef9b16-fcf3-4516-8835-7b9874ca7553"
type: "change"
title: "A string token count in an execution-log entry is concatenated into rex's per-command totals"
slug: "a-string-token-count-in-an-execution"
intent: "Trigger: an execution-log detail like `{\"inputTokens\":\"100\"}`. `extractRexTokenUsage` (packages/rex/src/core/token-usage.ts ~281) checks each field with `typeof === \"number\"` and counts 0, but `extractRexTokenEvents` (~504) uses `?? 0` and adds the string, so per-command totals become the string \"0100\" while the headline says 0.\n\nReachable: only from a malformed or hand-edited log line; logs written by rex itself carry numbers.\n\nFix options: (1, recommended) apply the same numeric guard in extractRexTokenEvents; tiny. (2) validate log details on read; larger.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "A non-numeric token field in an execution-log entry counts as 0 in both the headline and the per-command totals"
  - "A unit test feeds a string token count to extractRexTokenEvents and asserts numeric totals"
touches:
  - "ed1f0944-536d-44a4-ad18-d2f3e4827e16"
priority: "medium"
source: "ndx-adversarial-review"
---
