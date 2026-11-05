---
id: "5dc38be7-f9d3-4b0e-b45f-40f8e4a1435b"
type: "task"
title: "GET /api/tracker/cards/form has no test of its success path, so a broken tool lookup ships green"
slug: "get-api-tracker-cards-form-has-no-test"
description: "Adversarial review of a294dc86 (should-fix, medium). packages/web/src/server/routes-tracker.ts FORM_PATH finds the card's tool with `tools.find((t) => t.tool === card.call.tool)` and answers buildExternalCall. tests/integration/tracker-routes.test.ts only checks the 409 for no waiting card: its connection is unreachable (127.0.0.1:9), so the 200 path, the 422 for a tool the server does not list, and the picker choices from the CAOS profile's hints are never exercised. Reachable: Live's Approve calls this route on every card. A regression in the lookup (e.g. matching wireName) leaves Approve stuck on an error with every test green. Fix: a route test over the fake CAOS MCP server (startFakeMcpHttpServer + addCaosTools, as tracker-sync-engine.test.ts does) asserting the 200 externalCall (label, inputSchema, epicId options) and the 422; cost one test, no risk."
acceptanceCriteria:
  - "A tracker-routes test against the fake CAOS server gets 200 from /api/tracker/cards/form for a waiting create card, with the connection label and create_work_item's inputSchema"
  - "The same test sees picker options for a hinted property (epicId) from the CAOS profile"
  - "A card whose tool the server does not list answers 422 naming the tool"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
