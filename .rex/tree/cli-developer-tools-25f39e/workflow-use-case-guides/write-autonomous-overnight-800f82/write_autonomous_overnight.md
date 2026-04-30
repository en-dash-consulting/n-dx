---
id: "800f8220-0386-48d2-b566-22b5e46c3cea"
level: "task"
title: "Write Autonomous Overnight Operation Guide ('Run While You Sleep')"
status: "completed"
priority: "high"
tags:
  - "docs"
  - "hench"
  - "autonomous"
source: "smart-add"
startedAt: "2026-04-14T15:36:47.614Z"
completedAt: "2026-04-14T15:38:43.302Z"
acceptanceCriteria:
  - "Guide covers `ndx work --auto --iterations=N` and `ndx start --background` setup end-to-end"
  - "Guide explains how to set token budget limits and per-run guardrails to prevent runaway costs"
  - "Guide includes a 'morning after' section: how to check run history, review what was done, and handle partial or failed runs"
  - "Guide documents safe concurrency rules (what can run alongside what) referencing the Concurrency Contract in CLAUDE.md"
  - "Guide is structured as a scenario walkthrough, not a command reference — a developer unfamiliar with n-dx can follow it start to finish"
description: "Document how to configure and launch n-dx for unattended multi-iteration autonomous execution — overnight runs, long CI sessions, or background work while the developer is away. Covers hench auto mode, iteration limits, background server setup, how to monitor a running session, how to safely resume or inspect results in the morning, and guardrails to prevent runaway spending or broken states."
---
