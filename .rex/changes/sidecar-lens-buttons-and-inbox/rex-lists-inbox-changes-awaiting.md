---
id: "2d27d71a-bfc5-4ecf-a539-36a98e4c6304"
type: "task"
title: "Rex lists Inbox changes awaiting placement from the CLI, with age and shortlist"
slug: "rex-lists-inbox-changes-awaiting"
description: "Story E gaps. Add a CLI read listing every open change with needsPlacement, with its rules shortlist (top 5 with reasons) and relation default, e.g. 'rex change inbox [--format=json]' (pick the name that fits rex's CLI conventions; update packages/rex/src/cli/help.ts and the command manifest/docs parity tests). Each row carries id, title, intent, age (from the change's created or first-recorded time in state.yaml; add the field where it is missing), and the shortlist. Add the same age field to GET /api/rex/changes/placements (packages/web/src/server/routes-rex/placement.ts). On a v1 tree the CLI answers 'not applicable' plainly (exit 0, a message, and a JSON shape that says so) and the web route keeps its refusal; add a v1 test for changes/placements. No MCP shape change. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; add a patch changeset per package touched."
acceptanceCriteria:
  - "The CLI read lists every needsPlacement change with id, title, intent, age and a top-5 shortlist with reasons, in text and --format=json (rex tests)"
  - "GET /api/rex/changes/placements rows carry the same age (web test)"
  - "On a v1 tree the CLI read answers not applicable and changes/placements keeps its refusal (tests)"
  - "A changeset names the new read"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
