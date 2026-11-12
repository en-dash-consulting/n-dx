---
id: "1fcb43cc-2d0a-4f0e-af5e-4ef6aad90829"
type: "task"
title: "Establish a current OpenAI tool-call codec and truthful capabilities"
slug: "establish-a-current-openai-tool-call"
description: "Build the minimal provider request/event/tool-result contract required by an agent, using current official supported APIs rather than assuming a text Chat Completions provider is an agent loop.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Support current OpenAI tool-call request, response, streaming and error contracts for selected supported models, using Responses API where required."
  - "Round-trip tool calls/results through the existing vendor-neutral interfaces without claiming capabilities the implementation does not provide."
  - "Preserve authentication, trusted endpoints, usage/effort metadata and cancellation semantics; secrets never enter logs/tool children."
  - "Focused fixtures cover multi-step tool calls, tool failures, malformed responses and authentication failures."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-7"
source: "ndx-capture"
blockedBy:
  - "59ef46ac-3cae-43e7-89e0-c327f28ef32b"
---
