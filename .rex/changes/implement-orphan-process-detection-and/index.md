---
id: "4e870c51-cd43-47a2-89f2-02e8e4f3ce57"
type: "change"
title: "Implement orphan process detection and cleanup for spawned subcommands"
slug: "implement-orphan-process-detection-and"
intent: "Add a process-group-aware cleanup layer so that any child processes spawned during a CLI run (e.g., sourcevision analyze, hench run) are tracked and forcibly reaped if they outlive their parent command. Extend the existing graceful shutdown to cover abnormal termination paths."
acceptanceCriteria:
  - "All child processes are registered in a process registry at spawn time"
  - "On parent exit (clean, SIGINT, or unhandled exception), all registered children are sent SIGTERM then SIGKILL after a grace period"
  - "A test simulates a mid-run SIGINT and confirms no orphan processes remain after 5 seconds"
  - "The registry is a no-op in environments where process groups are not supported (Windows CI) — no crash, just a warning log"
amends: [{"target":"8abe3c45-9434-4862-aeee-0f56f107d130","delta":"modified","summary":"Implement orphan process detection and cleanup for spawned subcommands","base":"a975dbee8ab42b749038b58094584915f14fe194541a3954492631e8b798888c"}]
priority: "high"
tags:
  - "process-lifecycle"
  - "cli"
  - "reliability"
source: "smart-add"
---
