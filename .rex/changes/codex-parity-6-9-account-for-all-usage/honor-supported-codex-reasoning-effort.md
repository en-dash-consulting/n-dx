---
id: "c73a021f-4560-4bb6-9091-6d1622d860b9"
type: "task"
title: "Honor supported Codex reasoning-effort settings"
slug: "honor-supported-codex-reasoning-effort"
description: "Thread configured llm.effort through Codex CLI and OpenAI API completion paths. Preserve operator/user CLI effort when no n-dx override applies. Official reference: https://learn.chatgpt.com/docs/config-file/config-reference (model_reasoning_effort).\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Honor supported explicit effort settings consistently in Codex CLI and OpenAI API paths, including execution/review settings that resolve an effort."
  - "Validate against model/client capability; unsupported/invalid effort warns clearly rather than silently being ignored or sent blindly."
  - "When no n-dx override applies, preserve intentional user effort/client defaults."
  - "Apply approved tier/reviewer effort recommendations only through explicit supported default resolution, with configured pins taking precedence."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-6"
source: "ndx-capture"
blockedBy:
  - "bc6b57ed-338a-4d0d-b776-e2019a5de6fd"
---
