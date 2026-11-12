---
id: "d1edb11c-4673-4613-8345-3ee0f2462f79"
type: "task"
title: "Refresh unpinned Codex tiers, reviewers and init templates"
slug: "refresh-unpinned-codex-tiers-reviewers"
description: "Approved proposed defaults, verified in official docs on 2026-11-09: light gpt-6-luna; standard gpt-6.1-sol; heavy gpt-6-astra; routine reviewer gpt-6.1-sol; heavy reviewer gpt-6-astra. Proposed efforts once supported: Luna high, Sol medium, routine Sol reviewer high, Astra low initially. These are workload recommendations, not n-dx benchmark results. Reverify official guidance during implementation: https://learn.chatgpt.com/docs/models?surface=cli .\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Update unpinned execution tiers, reviewer defaults, init catalogs/templates, fallback defaults, help/examples and dashboard metadata consistently using then-current verified availability."
  - "Preserve every explicit llm, tier, hench, task and review pin; no automatic rewrite of saved user settings."
  - "Treat retired ChatGPT-only models separately from still-supported API models; retained API pins remain usable and labeled honestly."
  - "Effort recommendations are applied only once Codex effort plumbing is implemented and supported; otherwise leave client defaults and state the limitation."
  - "Add contract coverage for runtime/catalog/template agreement and the ordinary/explicit-pin upgrade paths."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-3"
source: "ndx-capture"
blockedBy:
  - "d0f52798-2869-423b-af3f-788175f450fc"
---
