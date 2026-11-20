---
id: "8d9405d1-a805-4254-b91f-36ed91469452"
type: "task"
title: "Refresh OpenAI model pricing and surface-specific context limits"
slug: "refresh-openai-model-pricing-and"
description: "Audit dated sources: https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/models/gpt-6.1-sol ; https://developers.openai.com/api/docs/models/gpt-6-luna ; https://developers.openai.com/api/docs/models/gpt-6-astra ; https://developers.openai.com/api/docs/models/gpt-5.5 ; https://developers.openai.com/api/docs/models/gpt-5.6-terra . Reverify at implementation, preserving the 2026-11-09 audit as historical evidence.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Cover proposed defaults and retained selectable models with verified dated official sources, including older intentionally pinned models."
  - "Distinguish API maximum context from effective Codex/Work context (the audit documented 1.05M API versus 500K default Codex context for GPT-6.1 Sol)."
  - "Represent applicable processing modes, cache-write durations and long-context pricing without treating subscription usage as an API invoice."
  - "Correct retained-model metadata; keep unknown pricing/context explicitly unknown rather than confidently applying another vendor's rates."
  - "Budget/preflight and dashboard estimates consume the same metadata; tests demonstrate that supported 150K-token prompts no longer fail solely on the unknown-model 128K fallback."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-2"
source: "ndx-capture"
blockedBy:
  - "dd75c28b-2c8c-42a7-883f-27c103aea682"
---
