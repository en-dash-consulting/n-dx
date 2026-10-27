---
id: "d97ee3e3-3b06-4b76-aecf-1f7051440601"
type: "change"
title: "No test covers the PRD watcher refreshing the cache on product/ or changes/ edits"
slug: "no-test-covers-the-prd-watcher"
intent: "Verdict: should-fix (adversarial review of 37f5f63bc). The task's description says the tree watcher refreshes .rex/.cache/prd.json when product/ or changes/ change. That is verified only by reading the code: start-cache-v2.test.ts covers refreshPRDCache, prdExists and prdMaxMtimeMs, but nothing exercises registerRexWatcher. Scenario: someone drops V2_PRODUCT_DIRNAME or V2_CHANGES_DIRNAME from the watched-folder list in start.ts. Every test stays green, and the dashboard stops live-updating on v2. Fix: export the watcher registration for tests (as refreshPRDCache already is, @internal), or test it through the WorkspaceHooks setup. Then edit a file under a copied v2 fixture and assert that the cache mtime changes within the debounce.\n\nFolded in on 2026-10-13: 8eb10061 (No test pins that a kept v2 completion suppresses the failed-run rollback) covered the same surface and was carried here with its acceptance criteria.\n\nOperator notes (2026-10-14, v2 hardening 4/5): packages/web only, except the criteria's tests. Hal's draft #742 edits packages/web/src/server/routes-live*.ts, routes-worktrees.ts, the hub proxy and the Live viewer files; stay out of them. Do not edit packages/rex/tests/unit/schema/v2.test.ts. Add a changeset (patch, @n-dx/web). Run the six static root policy tests before finishing: tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy and obfuscated-code-policy."
acceptanceCriteria:
  - "Removing changes/ from the watched folders in start.ts fails a test"
  - "Removing product/ from the watched folders in start.ts fails a test"
  - "A test with rollback enabled and a confirming rollback prompt shows that a kept v2 completion's change stays applied and the task stays completed after finalizeRun (folded in from 8eb10061)"
  - "The same test fails when the appliedChangeOfCompletion clause is removed from the rollback condition (folded in from 8eb10061)"
touches:
  - "7a93b80b-7460-40c3-975d-5fd555ef4264"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-36"
  - "web"
  - "v2-hardening"
source: "ndx-adversarial-review"
---
