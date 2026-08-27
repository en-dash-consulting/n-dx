---
id: "359b5e2c-e673-4e84-9c90-3f7e2cc29434"
level: "task"
title: "outputPerMToken is multiplied nowhere, so all output-side MODEL_COSTS figures are inert"
status: "pending"
priority: "medium"
tags:
  - "e2e-finding"
  - "cost-estimation"
  - "severity:medium"
source: "ndx-capture"
acceptanceCriteria:
  - "A decision is recorded on whether output rates should feed a live calculation or be documented as informational"
  - "If made live: a total-cost estimate incorporating outputPerMToken is reachable from a real caller and covered by a test asserting an exact total for a model whose input and output rates differ"
  - "If left informational: MODEL_COSTS carries a comment stating outputPerMToken feeds no computation"
  - "The relationship between this and budget preflight's input-only estimate is documented where MODEL_COSTS is defined"
description: "Found by the adversarial reviewer on run 60c3a951. `outputPerMToken` is never used in any computation anywhere in the codebase — its only references are presence and ordering assertions (budget-preflight.test.ts:170-184 asserting every entry has the field and that output >= input, and review-model.test.ts:112). The single live cost calculation, budgetPreflight (budget-preflight.ts:71-73), multiplies only `inputPerMToken`.\n\nConsequence for the task that just shipped (85923733): of its three corrections, the two output-side price edits — haiku-4-5 4.00→5.00 and opus-4-7 75.00→25.00 — change no computed value anywhere in the system. Only the inputPerMToken edits and the TIER_MODELS.claude.heavy repoint have live effect. The task's stated goal of accurate cost estimation is only half met, and the half that is met is the half nobody was tracking.\n\nDecide which way to resolve it: give the output rates a live consumer (a total-cost estimator that budget preflight or the token-budget check actually calls), or document the field as informational-only so future price corrections aren't mistaken for behavior changes. The first is more useful — output dominates cost on generation-heavy runs — but it is a feature, not a fix."
lastModified: "2026-08-27T16:49:10.672Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
