---
id: "0284c3d5-58ea-4fec-ba76-4762d708cc12"
level: "feature"
title: "JSON prompt discipline — compact JSON in and out"
status: "pending"
priority: "low"
tags:
  - "rex"
  - "prompts"
  - "output-tokens"
source: "ndx-capture"
acceptanceCriteria:
  - "No prompt-construction site embeds JSON with null, 2 pretty-printing (verified by grep or lint rule across packages/*/src)"
  - "rex prompts instruct the model to return minified JSON without markdown fences or surrounding prose"
  - "Existing response parsers still pass their tests against compact output"
description: "Prompt-embedded JSON is pretty-printed with JSON.stringify(x, null, 2) at 6+ rex sites (guard, decompose, assess, modify, …) — billed indentation on every call (audit R7). Output tokens cost ~5x input on every tier, so also request compact/minified JSON responses with no prose or fences and stop asking for restatements (design §07.8). Estimated 10–20% output-token reduction on rex calls at zero risk."
lastModified: "2026-08-28T17:39:00.686Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
