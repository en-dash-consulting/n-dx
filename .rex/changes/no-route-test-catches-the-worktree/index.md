---
id: "4191c8d5-58d7-4153-a3fa-17f2b813d792"
type: "change"
title: "No route test catches the worktree sidecar registry dropping its spend recorder"
slug: "no-route-test-catches-the-worktree"
intent: "Out-of-scope finding (low, pre-existing) from the adversarial review of b147e397, the hub registry spend test.\n\nScenario: defaultRegistryFor in packages/web/src/server/routes-sidecar.ts (about line 495) sets onTurnSpend: sidecarTurnSpendRecorder(ctx). Drop that line and every test stays green. routes-sidecar.test.ts:140 injects registryFor with its own SidecarSessionRegistry and passes sidecarTurnSpendRecorder(ctx) itself, so no route test ever runs the production option. Worktree sidecar spend would then vanish from LLM Utilization with no signal. This is the same shape as the hub gap that b147e397 closed.\n\nReachable: any worktree sidecar turn in production. It is a coverage gap; nothing fails today.\n\nOptions:\n1. (recommended) Give SidecarRouteOptions.registryFor a second argument carrying the production defaults (context, ttlMs, onTurnSpend), as HubSidecarRouteOptions.registryFor now has. routes-sidecar.test.ts spreads them and fakes only connect. Small seam change plus updating the existing spend assertions at routes-sidecar.test.ts:331/343 to rely on it.\n2. Leave the seam alone and add one test that runs a turn through the route's own registry (as sidecar-settings.test.ts does for TTL) with a faked vendor. This needs a spawn seam on createWorktreeSidecarRegistry, so it is more invasive."
acceptanceCriteria:
  - "A worktree sidecar route test posts a turn and finds a `sidecar` line in the project's dashboard usage ledger, with spend recorded by the registry options production builds in defaultRegistryFor"
  - "Removing onTurnSpend from defaultRegistryFor makes that test fail"
touches:
  - "05338f33-e638-49b8-815f-ed12949f0c63"
priority: "low"
discoveredFrom: {"item":"b147e397-606d-4194-b556-5324b87a8f49","run":"6a3636b0-fd04-4004-a384-ebd19ecdbe38"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
