---
id: "b1ae4664-1c13-4283-819c-87ac77e7fbb2"
type: "task"
title: "A missing PRD folder is reported as missing, not as a v1 project"
slug: "a-missing-prd-folder-is-reported-as"
description: "plan-queue's error (packages/hench/src/cli/commands/plan-queue.ts:182-187) says \"this project is still on v1\" whenever loadV2Tree returns undefined, and resolveStore (packages/rex/src/store/index.ts:124) falls back to the v1 store even for a folder that does not exist. Before choosing v1, check the folder exists; when it does not, ndx work, --resolve and --plan-queue say which folder they looked in and where the layout expects the PRD. Do not change behaviour for a real v1 tree. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "--plan-queue against a missing rex folder names the folder it looked in (hench test)"
  - "A real v1 tree still gets the v1 message (hench test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
