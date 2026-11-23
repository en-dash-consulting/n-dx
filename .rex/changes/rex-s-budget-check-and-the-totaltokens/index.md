---
id: "4cdfc22c-96b6-46f7-85b4-9c76d29c367d"
type: "change"
title: "Rex's budget check and the totalTokens doc disagree on which token kinds count"
slug: "rex-s-budget-check-and-the-totaltokens"
intent: "`checkBudget` (packages/rex/src/core/token-usage.ts) compares input + output tokens only, while the `totalTokens` doc comment (~185) says budget checks use all four kinds (including cache reads/writes). Trigger: 10M cache-read tokens with `budget.tokens = 1000` gives severity \"ok\".\n\nReachable: yes, on any Claude run with heavy cache reads; whether that is the intended rule is a product decision.\n\nFix options: (1) decide the rule, then make the code and the doc agree — either count cache tokens or correct the doc. Recommend correcting the doc unless budgets are meant to include cache traffic.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "The budget rule is documented once and checkBudget implements exactly that rule"
  - "A unit test pins whether cache tokens count toward the budget"
touches:
  - "2e921485-212e-49b8-a00a-f6666144dee4"
priority: "low"
source: "ndx-adversarial-review"
---
