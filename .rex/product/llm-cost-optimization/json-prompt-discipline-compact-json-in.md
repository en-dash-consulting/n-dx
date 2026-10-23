---
id: "0284c3d5-58ea-4fec-ba76-4762d708cc12"
type: "capability"
title: "JSON prompt discipline — compact JSON in and out"
slug: "json-prompt-discipline-compact-json-in"
statement: "Rex sends JSON embedded in its prompts in compact form and asks the model to answer in compact JSON."
criteria: [{"id":"c1","text":"When a prompt-construction site under packages/*/src embeds JSON in a prompt, it shall serialize that JSON without null, 2 pretty-printing."},{"id":"c2","text":"Rex prompts shall instruct the model to return minified JSON with no markdown fences and no surrounding prose."},{"id":"c3","text":"When the model returns compact JSON, the rex response parsers shall parse it."}]
tags:
  - "rex"
  - "prompts"
  - "output-tokens"
source: "ndx-capture"
priority: "low"
---

Prompt-embedded JSON is pretty-printed with JSON.stringify(x, null, 2) at 6+ rex sites (guard, decompose, assess, modify, …) — billed indentation on every call (audit R7). Output tokens cost ~5x input on every tier, so also request compact/minified JSON responses with no prose or fences and stop asking for restatements (design §07.8). Estimated 10–20% output-token reduction on rex calls at zero risk.
