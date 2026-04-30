---
id: "e49a1812-e055-435f-8c78-b059cc724fc4"
level: "task"
title: "Extract viewer from sourcevision into shared web package"
status: "completed"
priority: "high"
tags:
  - "architecture"
  - "viewer"
startedAt: "2026-02-10T04:30:37.010Z"
completedAt: "2026-02-10T04:30:37.010Z"
acceptanceCriteria: []
description: "Move the web server code (start.ts, routes-*.ts, websocket.ts, viewer HTML/CSS/JS) out of `packages/sourcevision/` into a proper home — either a new `packages/web` package or the monorepo root. The server already imports from rex, hench, and sourcevision; it should live at the orchestration layer, not inside one package. Includes updating build pipeline, package.json, and all import paths."
---

# Extract viewer from sourcevision into shared web package

🟠 [completed]

## Summary

Move the web server code (start.ts, routes-*.ts, websocket.ts, viewer HTML/CSS/JS) out of `packages/sourcevision/` into a proper home — either a new `packages/web` package or the monorepo root. The server already imports from rex, hench, and sourcevision; it should live at the orchestration layer, not inside one package. Includes updating build pipeline, package.json, and all import paths.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** architecture, viewer
- **Level:** task
- **Started:** 2026-02-10T04:30:37.010Z
- **Completed:** 2026-02-10T04:30:37.010Z
- **Duration:** < 1m
