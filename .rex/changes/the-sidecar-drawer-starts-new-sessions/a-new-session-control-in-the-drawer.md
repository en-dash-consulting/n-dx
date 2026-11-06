---
id: "ca3fe259-00ec-4b7f-a08c-c1d0b103d543"
type: "task"
title: "A New session control in the drawer head, the sessions list and the ended-session bar"
slug: "a-new-session-control-in-the-drawer"
description: "There is no way to start a Sidecar session on purpose: the drawer head (packages/web/src/viewer/components/sidecar-drawer.ts:400-410) has Sessions and ×, the sessions list (sidecar-sessions.ts:66-97) has Resume, Rename and End per row, sessions are created only implicitly (viewer/hooks/use-sidecar.ts:762, 780-799), opening the drawer follows the latest live session, and an ended session leaves a dead-end bar (sidecar-drawer.ts:470). Add newSession to use-sidecar (create with the current agent and model and the current page attached) and a \"New session\" button in the drawer head, at the top of the sessions list, and in the ended-session bar. Live sessions it leaves stay resumable from the list. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "New session in the head, the list and the ended bar each open a fresh session with the page attached (viewer tests)"
  - "The previous live session stays in the list and resumes (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
