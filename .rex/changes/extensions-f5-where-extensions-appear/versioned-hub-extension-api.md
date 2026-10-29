---
id: "2b42b7b6-4d54-4824-bf97-93e2f5d6f8ba"
type: "task"
title: "Versioned hub extension API"
slug: "versioned-hub-extension-api"
acceptanceCriteria:
  - "`GET /api/hub/extensions[?project=<id>]` and `POST /api/hub/extensions/:name/stop`"
  - "`GET /api/hub/projects` and `POST /api/hub/projects` documented as stable under `apiVersion` 1, with contract tests"
priority: "high"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "e9435b47-1ab2-4739-9338-ab00f1c518d6"
---
