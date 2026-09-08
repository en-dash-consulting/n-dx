---
id: "6a4c8eac-7d3c-4535-a983-808cd9e04fbb"
level: "feature"
title: "Extend PromptEnvelope Beyond Hench"
status: "pending"
priority: "high"
tags:
  - "prompts"
  - "llm-client"
  - "tokens"
  - "architecture"
blockedBy:
  - "76076f6a-c23c-4905-864b-5218a5a6ee69"
source: "ndx-capture"
acceptanceCriteria:
  - "Rex and sourcevision build their LLM prompts through createPromptEnvelope and assemblePrompt rather than assembling raw strings, so section boundaries are explicit."
  - "Per-section token diagnostics are available for rex and sourcevision prompts by the same mechanism hench uses, not a parallel implementation."
  - "Any change to runtime-contract.ts keeps hench's prompt parity, envelope parity, and envelope regression suites passing, with no behavioural change to hench's assembled output."
  - "The foundation-tier boundary holds: rex and sourcevision reach llm-client without importing each other, and the domain-isolation test suite still passes."
  - "Prompt text is unchanged by this feature — it is a restructuring step only, so the recorded baseline totals stay identical apart from any deliberate whitespace normalisation."
  - "Diagnostics reveal, for each migrated prompt, which sections dominate its token cost, so the follow-on rewrites can target the largest sections first."
description: "The section-structured prompt abstraction already exists — PromptEnvelope, PromptSection, createPromptEnvelope and assemblePrompt in packages/llm-client/src/runtime-contract.ts, with per-section diagnostics via hench's prompt-diagnostics.ts and PromptSectionDiagnosticSchema. But of the 30 files referencing it, every one is hench or llm-client's own tests. Rex and sourcevision, which hold the overwhelming majority of the measurable static prompt text, build raw strings with no section structure and no way to attribute cost to a part of a prompt. Extend the envelope to those packages so their prompts become measurable and individually trimmable, giving the rex and sourcevision rewrites the same before-and-after evidence hench already gets. llm-client is the foundation tier, so this widens a shared contract — the change must not break hench's existing envelope parity and regression suites."
lastModified: "2026-09-08T13:40:36.277Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
