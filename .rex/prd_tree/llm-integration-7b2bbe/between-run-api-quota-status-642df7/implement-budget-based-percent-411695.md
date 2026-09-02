---
id: "41169580-92d1-4032-b5ee-60ef39f13c52"
level: "task"
title: "Implement budget-based percent-remaining calculation for active providers"
status: "completed"
priority: "medium"
tags:
  - "llm"
  - "quota"
  - "hench"
source: "smart-add"
startedAt: "2026-04-08T20:28:30.708Z"
completedAt: "2026-04-08T20:46:17.870Z"
acceptanceCriteria:
  - "Returns percent-remaining for each active provider (claude, codex) based on configured weekly budget and accumulated spend"
  - "Falls back gracefully — no error thrown, no run blocked — when quota data is unavailable or budget is not configured"
  - "Result conforms to the typed interface defined in the preceding task"
  - "Unit tests cover: normal output with expected percentages, missing config fallback returning empty array, zero-spend edge case returning 100%"
description: "Fill in the quota check logic introduced by the previous task. Query accumulated spend vs. configured weekly budget for each active provider (Claude, Codex) using the existing token usage tracking infrastructure and/or provider-reported rate-limit headers captured during the run. Compute percent remaining per provider/model and return the typed result array. Degrade silently when quota data is unavailable or budget is not configured."
---
