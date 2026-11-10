---
id: "350dbd5a-c148-4ba1-ab80-683fa5c2ac0d"
type: "change"
title: "Credential store leftovers: Claude deny rule, Codex key handling and OS keystores"
slug: "credential-store-leftovers-claude-deny"
intent: "The tasks left open when the credential-store change (7d8853e2) was closed so its Per-user credential store capability could be applied: the Claude CLI deny rule for an abbreviated security find-generic-password, Codex agent commands and a user-exported OPENAI_API_KEY, the Auth lines after a refused store, a test for Codex's empty OPENAI_API_KEY, the scrub warning's claims, and the deferred OS keystore backends (C10). Split out in the 2026-11-06 PRD audit (decision D5)."
touches:
  - "2c0a3e60-2840-4695-8aee-fb720b6f9a1e"
priority: "high"
discoveredFrom: {"item":"7d8853e2-2aaa-4ee5-aa15-9d4d14400905"}
tags:
  - "credential-store"
  - "follow-up"
source: "prd-v2-map-audit D5"
---
