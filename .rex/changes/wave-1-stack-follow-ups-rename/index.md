---
id: "62a0d339-f193-4a94-8a9c-9e9db081adc4"
type: "change"
title: "Wave 1 stack follow-ups: rename recovery and checkpoint guard outcome"
slug: "wave-1-stack-follow-ups-rename"
summary: "Three review findings from the #998 to #1008 stack that are safe to leave for after it merges: give operators a working recovery command for renamed files, protect files moved with plain mv during rollback, and keep a Sidecar turn from reporting two contradicting outcomes when the MCP guard fires during a checkpoint."
intent: "Deliberate follow-ups from the round-2 review of the #998 to #1008 stack, named as known follow-ups in the PR descriptions. Not repairs to land inside the stack: each is safe as shipped (recovery withholds commands instead of printing destructive ones; the plain-mv gap predates the stack; the checkpoint case is behind experimental web.sidecar and loses neither spend nor answer). Captured on the stack tip so the items reach main with it."
acceptanceCriteria:
  - "The three follow-up tasks are complete after the stack merges."
touches:
  - "9cea889f-17de-4b92-a97e-b7279e158578"
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
source: "ndx-capture"
---
