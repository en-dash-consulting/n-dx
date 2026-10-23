---
id: "e49a1812-e055-435f-8c78-b059cc724fc4"
type: "change"
title: "Extract viewer from sourcevision into shared web package"
slug: "extract-viewer-from-sourcevision-into"
intent: "Move the web server code (start.ts, routes-*.ts, websocket.ts, viewer HTML/CSS/JS) out of `packages/sourcevision/` into a proper home — either a new `packages/web` package or the monorepo root. The server already imports from rex, hench, and sourcevision; it should live at the orchestration layer, not inside one package. Includes updating build pipeline, package.json, and all import paths."
touches:
  - "ed4461f5-7667-4c72-bbee-f39457b951fe"
priority: "high"
tags:
  - "architecture"
  - "viewer"
---
