---
id: "e5def056-c6ed-4484-978e-6f4e174bd8bf"
type: "task"
title: "C6: Jev availability is visible, llm.typesafe.required warns, and --test proves the key"
slug: "c6-jev-availability-is-visible-llm"
description: "PR 3. Done-when re-tightened before PR 3 starts."
acceptanceCriteria:
  - "ndx status, ndx config credentials, rex get_capabilities and manifest.lastAnalysis report Jev availability and the key's source"
  - "With llm.typesafe.required: true, a run that falls back prints one warning per run naming the fix"
  - "ndx config credentials.typesafe --test makes one call (mocked fetch in tests) and never prints the key"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "12d277fe-4308-47dd-9a3e-9634d4b829f6"
  - "742863c5-989f-4138-8909-9b59bb589fc4"
---
