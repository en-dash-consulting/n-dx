---
id: "f26763d3-04a3-4be7-86b0-0ee5321934f4"
type: "task"
title: "Connections doc says how Create in tracker treats an off rule"
slug: "connections-doc-says-how-create-in"
description: "Stack review finding on #988 (review body), docs/architecture/sidecar-connections.md:125: the doc says every rule is off unless set, but raiseCreateCard (sync-engine.ts:203) forces the event's rule to on before planning, on purpose ('an off rule does not stop an explicit request'). The 'Routes, governed by web.sidecar' list also leaves out POST /api/tracker/changes/:id/create and GET /api/tracker/changes/:id/state."
acceptanceCriteria:
  - "docs/architecture/sidecar-connections.md says an explicit Create in tracker raises the card whatever the create rule's mode, and makes no tracker call until the card is approved"
  - "The routes list includes POST /api/tracker/changes/:id/create and GET /api/tracker/changes/:id/state"
---
