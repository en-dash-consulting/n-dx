---
id: "d1438d1e-9233-4fff-a6d9-6a218d5d50bc"
type: "change"
title: "Rex Command Vendor-Model Binding Regression Fix"
slug: "rex-command-vendor-model-binding"
intent: "When `ndx config llm.vendor codex` is set, rex CLI commands (analyze, recommend, add, etc.) should resolve and use GPT-family models rather than falling back to Claude defaults. The centralized resolver exists but rex call sites may not be reading vendor config correctly or may be bypassing the resolver."
touches:
  - "e34e664a-b788-41e5-ad5d-95c94d9abd8a"
source: "smart-add"
---
