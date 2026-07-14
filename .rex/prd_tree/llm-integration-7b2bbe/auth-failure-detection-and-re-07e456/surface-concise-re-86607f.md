---
id: "86607ff0-0969-4366-bccb-1a2de835fdcb"
level: "task"
title: "Surface concise re-authentication guidance when provider auth fails"
status: "pending"
priority: "high"
tags:
  - "auth"
  - "ux"
  - "error-handling"
source: "smart-add"
acceptanceCriteria:
  - "Auth failure output contains no raw JSON payloads or internal error fields in the primary message"
  - "Output names the provider, states 'Invalid or expired credentials', and includes at least one concrete remediation command"
  - "ANSI error color is applied consistently with existing error-hint rendering (red/yellow)"
  - "Integration test snapshot asserts the user-facing message format and confirms absence of JSON blobs"
  - "Behavior is consistent across ndx init, ndx work, ndx plan, and ndx analyze entry points"
  - "The NDX error code (e.g., NDX_CLAUDE_PREFLIGHT_INVOKE_FAILED) appears as a secondary diagnostic line, not the headline"
description: "Replace the current verbose raw-JSON error dump with a short, ANSI-colored error message that names the failing provider, states the root cause (invalid credentials, expired session, or missing API key), and gives the exact commands needed to fix it — e.g., 'claude logout && claude login' for the Claude provider or 'ndx config llm.google.api_key <KEY>' for API-key providers. The message format should be consistent with the existing error-hint palette and include the NDX_CLAUDE_PREFLIGHT_INVOKE_FAILED error code only as a secondary detail, not the primary output."
---
