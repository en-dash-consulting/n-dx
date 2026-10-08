---
id: "811a8fe1-7efa-4b32-a4ca-ac36d1b753c6"
level: "task"
title: "Give each degraded mode a specific, actionable message"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "ux"
  - "error-handling"
blockedBy:
  - "514d0d03-868a-4eaf-abeb-3e2abdd38bd5"
  - "74c3fee8-3281-4b30-8157-8794ea68aea5"
source: "ndx-capture"
startedAt: "2026-09-04T19:08:00.656Z"
completedAt: "2026-09-04T19:23:52.977Z"
endedAt: "2026-09-04T19:23:52.977Z"
resolutionType: "code-change"
resolutionDetail: "Per-mode failure presentation for the Ask panel: new views/ask-failure.ts, analyze affordance lifted to components/analyze-controls.ts, endpoint sends canonical authFailureGuidance remediation and stops describing one failure while coding another."
acceptanceCriteria:
  - "With no .sourcevision/ data present, the panel explains that analysis must run first and surfaces the existing analyze/refresh affordance instead of only naming a command"
  - "With absent or invalid credentials, the message derives from llm-client's authFailureGuidance / VERIFY_CREDENTIALS_STEP, not from new ad-hoc wording"
  - "Timeout, rate limit, and provider error are each reported as themselves, and the two that are worth retrying offer a retry"
  - "The prompt text survives every failure so the user never has to retype the question"
  - "No degraded path renders a bare generic error string; a unit test asserts this for all three modes"
description: "The panel has three distinct ways to be unusable, and they need three distinct messages -- at parity with the degraded-mode hardening already done for PR Markdown refresh (see the SourceVision PR Markdown Refresh Degraded-Mode Hardening feature and pr-markdown-refresh-diagnostics.ts).\n\n1. No analysis data: .sourcevision/ is missing or empty -- the panel cannot ground an answer. Tell the user to run analyze, and offer the existing refresh/analyze action rather than only naming the command.\n2. Missing or invalid LLM credentials: reuse llm-client's existing authFailureGuidance / VERIFY_CREDENTIALS_STEP rather than inventing new wording.\n3. LLM failure at request time: timeout, rate limit, or provider error, each named as itself, with retry offered where retrying is sensible.\n\nA bare \"request failed\" for any of these is the specific outcome this task exists to prevent."
lastModified: "2026-09-04T19:23:53.001Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
