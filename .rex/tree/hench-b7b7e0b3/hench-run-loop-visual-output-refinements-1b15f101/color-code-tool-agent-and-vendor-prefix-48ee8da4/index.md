---
id: "48ee8da4-56b6-4201-ae86-5e9372b45543"
level: "task"
title: "Color-code [Tool], [Agent], and vendor prefix labels in hench run output"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "cli"
  - "color"
  - "ux"
source: "smart-add"
startedAt: "2026-04-08T23:21:17.861Z"
completedAt: "2026-04-08T23:29:06.354Z"
acceptanceCriteria:
  - "[Tool] prefix renders in grey/dim ANSI color when stdout is a TTY"
  - "[Agent] prefix renders in yellow ANSI color when stdout is a TTY"
  - "Vendor/model labels (e.g. [claude], [codex]) render in blue ANSI color when stdout is a TTY"
  - "All three prefix types render without any ANSI codes when NO_COLOR is set or stdout is not a TTY"
  - "Color wrapping delegates to existing semantic helpers in llm-client — no new color utility code is introduced"
description: "Hench run console output includes source-attribution prefix markers such as [Tool], [Agent], and vendor/model identifiers (e.g. [claude], [codex]). These prefixes should be color-coded to let users visually scan and distinguish message origins at a glance: [Tool] in grey/dim, [Agent] in yellow, and vendor/model labels in blue. The existing semantic color helpers in llm-client (colorDim, colorWarn, colorInfo) should be used so TTY and NO_COLOR behavior is already handled."
---
