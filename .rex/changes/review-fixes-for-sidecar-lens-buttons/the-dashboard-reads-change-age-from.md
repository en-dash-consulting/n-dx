---
id: "3dbde353-e500-49f7-aa83-b174694c0ea7"
type: "task"
title: "The dashboard reads change age from rex instead of copying rex's age rule"
slug: "the-dashboard-reads-change-age-from"
description: "PR review comment on #997 (packages/web/src/server/routes-rex/placement.ts:217): the web placement route copies rex's changeAge (packages/rex/src/core/change-inbox.ts) line for line, so the dashboard and rex change inbox can drift (the createdAt import fix would land in one place only). Without growing the rex gateway's exports: have rex's placement suggestion (or the input placementWire already reads) carry createdAt and ageDays computed by rex, and have web read them. Remove the copy. Keep GET /api/rex/changes/placements' response shape. Check docs/architecture/gateways.md and the gateway ceiling before touching rex-gateway.ts. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "placement.ts has no age computation of its own and the route's rows carry rex's createdAt and ageDays (web test)"
  - "The rex gateway's export count does not grow (policy test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
