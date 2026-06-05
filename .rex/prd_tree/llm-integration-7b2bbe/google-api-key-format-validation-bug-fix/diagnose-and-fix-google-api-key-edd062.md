---
id: "edd06255-7a7a-457a-8093-de91381a554b"
level: "task"
title: "Diagnose and fix Google API key format validation rejecting valid keys"
status: "completed"
priority: "critical"
tags:
  - "google"
  - "llm"
  - "bug"
  - "validation"
source: "smart-add"
startedAt: "2026-06-05T14:41:58.415Z"
completedAt: "2026-06-05T18:32:24.559Z"
endedAt: "2026-06-05T18:32:24.559Z"
resolutionType: "code-change"
resolutionDetail: "Fixed env var inconsistency (GOOGLE_API_KEY → GEMINI_API_KEY), wired googleConfig.apiKeyEnv into runtime factory, fixed error message typo, added 9 regression tests for ndx config llm.google.api_key validation."
acceptanceCriteria:
  - "A valid Google AI Studio API key (starting with AIza, 39 chars) is accepted without error via `ndx config llm.google.api_key <key>`"
  - "A valid key is also accepted when entered during `ndx init` provider selection"
  - "A key that does NOT start with AIza or is fewer than 30 characters is still rejected with the format error"
  - "The fix is isolated to the validation logic and does not alter the API key storage path or downstream usage"
description: "Trace the validation path that fires when a user sets llm.google.api_key via ndx config or ndx init. Identify whether the failure is in the regex pattern (e.g. anchoring, character class), the length threshold, the field name mapping (api_key vs apiKey), or a config schema coercion step. Fix the validation so that a freshly generated Google AI Studio key (which starts with AIza and is 39 characters) passes without triggering the format error. Confirm the fix works both through ndx config and the init provider-selection flow."
---
