---
id: "c2b2b6c1-6463-4ba4-a8db-9aeff5f7e81b"
type: "task"
title: "The Sidecar reports a refused or failed start instead of \"Started run\""
slug: "the-sidecar-reports-a-refused-or"
description: "routes-sidecar.ts:490-497 turns the 202 from startTaskExecution (packages/web/src/server/routes-hench.ts:2278, 202 at :2516-2529) into \"Started run … follow it on Live\" before ndx work has run its preflight; when hench exits 1 seconds later (dirty tree, missing task) the dashboard marks the run failed (routes-hench.ts:2444-2495) but the Sidecar card's carriedOut stays ok:true (broker.ts:270-277 returns early once set), the tool row stays green, the run-plan lane badge reads Started for good (viewer/components/sidecar-cards.ts:261-271) and the agent is told it started. Fix: start_work waits for the execution to pass its starting phase (the existing ~2000 ms starting-to-running timer, routes-hench.ts:2427-2433) or to exit, and reports the exit's error text when it failed; a later failure of a started run updates the card (carriedOut can be revised to failed), the lane badge returns to open, and the agent gets the failure as the tool result. The start route keeps answering 202 for other callers unless they opt in. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "A start that hench refuses comes back to the Sidecar as failed with hench's message (web test)"
  - "A run-plan lane whose start failed reads open again (viewer test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
