---
id: "e5def056-c6ed-4484-978e-6f4e174bd8bf"
type: "task"
title: "C6: Jev availability is visible, llm.typesafe.required warns, and --test proves the key"
slug: "c6-jev-availability-is-visible-llm"
description: "PR 3, first task (cut from PR 2's tip after T8). Jev availability and the key's source (env, file or helper, from credentialStatus) become visible; llm.typesafe.required makes a fallback warn; --test proves the key. Never print the key; no live TypeSafe call in any suite."
acceptanceCriteria:
  - "ndx status prints jev: available (env|file|helper) or jev: unavailable naming ndx config credentials.typesafe (e2e with a temp home)"
  - "rex get_capabilities gains jev: {available, source} from credentialStatus, never a value (MCP test)"
  - "sourcevision manifest.lastAnalysis gains an optional jev: {available, source} in schema/v1.ts and validate.ts (schema test)"
  - "llm.typesafe.required: true is a validated ndx config key; when a Jev-routed call falls back, one warning per process names ndx config credentials.typesafe (unit test: two fallbacks, one warning); unset, the fallback stays silent"
  - "ndx config credentials.typesafe --test makes one request and reports ok, rejected or unreachable with the fingerprint, never the key; tests use a mocked fetch and no suite makes a live call"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "12d277fe-4308-47dd-9a3e-9634d4b829f6"
  - "742863c5-989f-4138-8909-9b59bb589fc4"
---
