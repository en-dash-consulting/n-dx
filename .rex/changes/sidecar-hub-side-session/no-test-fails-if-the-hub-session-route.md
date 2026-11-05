---
id: "7c678969-1cd3-46f4-a629-1b7e917dba5e"
type: "task"
title: "No test fails if the hub session route stops scoping its broker to the hub's tools"
slug: "no-test-fails-if-the-hub-session-route"
description: "Verdict: should-fix (severity medium), found by ndx-adversarial-review of task 9c32dda8.\n\nScenario: delete `brokerScope: \"hub\"` from the handleSessionRoutes call in handleHubSidecarRoute (packages/web/src/server/routes-sidecar.ts). A hub session's broker then serves the worktree tool set (start_work, propose_edit, propose_prd_change, place_change_card, migration_decision, unrestricted run_command), and no test fails. tests/unit/server/sidecar-hub-broker.test.ts calls createBrokerMcpServer with scope \"hub\" directly and never goes through the route; routes-sidecar-hub.test.ts never calls the hub /mcp endpoint, because its fake Claude ends every turn at once.\n\nReachable: yes. Every hub session turn reaches its broker at /api/sidecar/hub/sessions/:id/mcp.\n\nOptions: (A, recommended) teach the routes-sidecar-hub test's fake spawn a HANG prompt, as routes-sidecar.test.ts does, then list tools over StreamableHTTPClientTransport at the hub mcp path and assert exactly draft_github_post, ledger_append, run_command, save_draft. Cost: one test plus a fake-spawn branch. (B) Make the broker scope come from the session record's scope (\"hub\") inside handleSessionRoutes, so the route cannot forget it, and test that. Cost: a small refactor."
acceptanceCriteria:
  - "A test lists the tools of a running hub session through its /api/sidecar/hub/sessions/:id/mcp route and asserts exactly draft_github_post, ledger_append, run_command and save_draft"
  - "That test fails when brokerScope: \"hub\" is removed from handleHubSidecarRoute"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
