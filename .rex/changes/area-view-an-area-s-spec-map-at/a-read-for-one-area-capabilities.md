---
id: "50c98ea3-d30c-4eea-8df7-fece3958d327"
type: "task"
title: "A read for one area: capabilities, constraints, open changes and Inbox guesses"
slug: "a-read-for-one-area-capabilities"
description: "A new route under routes-rex (beside GET /api/rex/product and /product/capability/<id>): GET /api/rex/product/area/<slug-or-id>. It answers the area's summary and stewards; each capability with statement, criteria count, computed status and health, and the open changes touching or amending it (with stage); the constraints that bind the area; the Inbox changes whose top placement candidate is in this area (from the batch placement read); the last five applied changes; and any code links. Computed by rex through the web rex gateway; the viewer derives nothing. On v1 it answers { layout: \"v1\" }."
acceptanceCriteria:
  - "The route answers one area's capabilities, constraints, open changes, Inbox guesses, recent applied changes and code links on the v2 fixture"
  - "An unknown slug answers 404 and a v1 tree answers { layout: \"v1\" }"
  - "It answers in under one second on this repository's PRD"
  - "Route tests cover the shape, 404 and v1"
priority: "medium"
source: "ndx-capture"
---
