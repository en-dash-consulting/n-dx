---
id: "29a2a782-dfe9-40f6-ad62-1de097395062"
level: "task"
title: "Command manifest: treat absent llm.vendor as claude in hasLlmVendor"
status: "pending"
priority: "critical"
acceptanceCriteria:
  - "A project whose .n-dx.json lacks llm.vendor shows plan/recommend/add/work/self-heal/pair-programming as available when initialized"
  - "needs-llm renders only when no vendor is resolvable at all"
  - "The default mirrors config.js runAuthCheck (absent vendor resolves to claude)"
description: "Blocking. hasLlmVendor (routes-commands.ts:1045) requires a non-empty explicit llm.vendor string in .n-dx.json, but the CLI defaults absent vendor to claude (config.js runAuthCheck ~2079, reshape.ts:113 getLLMVendor() ?? 'claude'). Projects that never set vendor explicitly get needs-llm chips and disabled Run buttons for plan, recommend, add, work, self-heal, and pair-programming — commands that run fine from the terminal. Fix: mirror the CLI default (absent vendor => claude) or key on 'has a resolvable vendor config' instead of 'has an explicit vendor key'."
---
