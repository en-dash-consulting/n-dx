---
id: "9e9585d0-a3a0-4dd4-bda0-bc6472609643"
level: "task"
title: "Pass --auto when the dashboard starts Self-Heal"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "phase-1"
  - "web-server"
startedAt: "2026-10-02T05:16:30.611Z"
completedAt: "2026-10-02T05:24:32.605Z"
endedAt: "2026-10-02T05:24:32.605Z"
resolutionType: "code-change"
resolutionDetail: "Self-heal route spawns with --auto; unit test asserts argv; panel copy says unattended."
acceptanceCriteria:
  - "The self-heal route passes --auto, and a unit test asserts the spawned argv contains it."
  - "The Self-Heal panel's copy says the run is unattended (no prompts) once started."
description: "POST /api/commands/self-heal spawns `ndx self-heal N [--verbose|--debug] <dir>` without `--auto` (packages/web/src/server/routes-commands.ts, the `cmdArgs` built near line 791). packages/core/self-heal-confirm.js:166-176 refuses without a TTY unless `selfHeal.autoConfirm` is set, so the dashboard's Run Self-Heal button fails for everyone who has not set that key. The dashboard already asks for consent in the UI (\"I understand — proceed\" in viewer/views/commands.ts:445), so passing --auto is the honest translation of that consent. Also recorded as a verified defect in the 2026-09-24 command-flow audit."
lastModified: "2026-10-02T05:24:32.989Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
