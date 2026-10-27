---
id: "41169580-92d1-4032-b5ee-60ef39f13c52"
type: "change"
title: "Implement budget-based percent-remaining calculation for active providers"
slug: "implement-budget-based-percent"
intent: "Fill in the quota check logic introduced by the previous task. Query accumulated spend vs. configured weekly budget for each active provider (Claude, Codex) using the existing token usage tracking infrastructure and/or provider-reported rate-limit headers captured during the run. Compute percent remaining per provider/model and return the typed result array. Degrade silently when quota data is unavailable or budget is not configured."
acceptanceCriteria:
  - "Returns percent-remaining for each active provider (claude, codex) based on configured weekly budget and accumulated spend"
  - "Falls back gracefully — no error thrown, no run blocked — when quota data is unavailable or budget is not configured"
  - "Result conforms to the typed interface defined in the preceding task"
  - "Unit tests cover: normal output with expected percentages, missing config fallback returning empty array, zero-spend edge case returning 100%"
amends: [{"target":"642df761-d076-4309-bd5c-edba76604dfd","delta":"modified","summary":"Implement budget-based percent-remaining calculation for active providers","base":"729f559c0f66f8d68a92209c7e30f7dbf188c0e34ff28c73b2830c815f13747f"}]
priority: "medium"
tags:
  - "llm"
  - "quota"
  - "hench"
source: "smart-add"
---
