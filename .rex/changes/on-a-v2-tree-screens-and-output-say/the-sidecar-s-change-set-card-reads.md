---
id: "785c4836-0aff-4725-baca-33d10834bf42"
type: "task"
title: "The Sidecar's change set card reads PRD edits and plan-queue lanes read tracks"
slug: "the-sidecar-s-change-set-card-reads"
description: "Decision CT3. The Sidecar card kind label \"Change set\" (packages/web/src/viewer/components/sidecar-cards.ts:53) is a batch of PRD writes, not a v2 change: label it \"PRD edits\". The plan-queue's \"lane\" (one branch running 1–3 tasks of one change, packages/hench/src/queue/plan-queue.ts:10-29) collides with the worktree lanes design: on screen it becomes \"track\": the run-plan card's count and rows (sidecar-cards.ts:102-103, 337, \"Lane N · change X\", \"Start lane\"), Live's Ready next (views/live-ready-next.ts) and ndx work --plan-queue's printed output. Code identifiers, JSON keys and the plan-queue schema stay as they are. Update the Sidecar lens instructions (packages/web/src/server/sidecar/lens-instructions.ts) so the agent uses the same words. Shared rules: on a v1 tree (.rex/prd_tree/) the v1 words stay as they are — change only what a v2 tree shows; viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; change user-facing words only, not stored field names, CLI flags or MCP tool names (0.9.0 soft freeze); run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "The change set card reads PRD edits (viewer test)"
  - "Run-plan cards, Ready next and --plan-queue text say track, and their JSON is unchanged (viewer and hench tests)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
