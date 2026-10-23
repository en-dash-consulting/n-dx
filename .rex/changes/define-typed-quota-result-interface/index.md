---
id: "af8ede6d-f8ff-4460-9816-34ed51c3fa7d"
type: "change"
title: "Define typed quota result interface and identify invocation point in hench run loop"
slug: "define-typed-quota-result-interface"
intent: "Establish the TypeScript interface for the quota-remaining result object and locate the correct insertion point in the hench multi-run loop where the check should fire — after each run completes and before the next begins. No calculation logic yet; this task is scoped to type definition and wiring the call site so the follow-on implementation task has a stable contract to fill in."
acceptanceCriteria:
  - "A named TypeScript interface or type alias (e.g., `QuotaRemaining`) is defined with at minimum `vendor: string`, `model: string`, and `percentRemaining: number` fields"
  - "The invocation point in the hench multi-run loop is identified and a stub call (returning an empty array) is inserted so the wiring compiles and tests can reference the hook"
  - "The stub is placed such that it fires after each run completes and before the next one begins in multi-run loops"
  - "No run is blocked and no error is thrown when the stub returns an empty array"
touches:
  - "642df761-d076-4309-bd5c-edba76604dfd"
priority: "medium"
tags:
  - "llm"
  - "quota"
  - "hench"
source: "smart-add"
---
