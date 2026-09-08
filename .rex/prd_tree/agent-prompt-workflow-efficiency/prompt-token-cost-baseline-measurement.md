---
id: "76076f6a-c23c-4905-864b-5218a5a6ee69"
level: "feature"
title: "Prompt Token-Cost Baseline & Measurement"
status: "pending"
priority: "high"
tags:
  - "prompts"
  - "tokens"
  - "measurement"
source: "ndx-capture"
acceptanceCriteria:
  - "A single checked-in inventory lists every prompt surface with its file path, purpose, and measured token cost at HEAD before any rewrite."
  - "Token counts are produced by the existing llm-client token path, not a newly invented estimator, so the numbers match what a real run is billed."
  - "An assembled task brief for a fixed representative task can be dumped and counted on demand by a documented command, making the measurement repeatable by anyone."
  - "The baseline distinguishes fixed prompt text from context assembled per run, so later reductions are attributed to the right surface."
  - "Re-running the measurement after a rewrite emits a before-and-after comparison rather than only the current total."
description: "Establish the measurement substrate the rest of this epic is judged against. Inventory every prompt surface that reaches an agent and record its token cost before any rewriting, so \"we made it cheaper\" is a number rather than a claim. Covers the four hench prompt modules, the .claude/skills/ set, and the shipped assistant-assets skills. Reuse the existing token-parsing path in packages/hench/src/prd/llm-gateway.ts rather than adding a second counter."
lastModified: "2026-09-08T13:07:36.807Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
