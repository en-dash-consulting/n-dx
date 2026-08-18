---
id: "35a6da7c-a1a4-496a-8189-9cee15e5b486"
level: "task"
title: "Stream job output incrementally via spawnManaged so progress UI renders while running"
status: "pending"
priority: "critical"
acceptanceCriteria:
  - "While a full sv-analyze, refresh, or self-heal runs, the status endpoints return incrementally growing output/phases"
  - "AnalyzeControls, enrichment-gate, RefreshPanel, and SelfHealPanel show live progress during running:true"
  - "Jobs use spawnManaged with piped stdio; the exec({signal}) addition is removed and stop uses spawnManaged kill()"
  - "self-heal-live.test.ts fixtures match a shape the server actually produces"
description: "Blocking. sv-analyze full, refresh, and self-heal use the buffered foundation exec() (execFile), so svAnalyzeStatus.recentOutput, refreshStatus.phases, and selfHealStatus.output are populated only in .then() after the child exits — but overview.ts AnalyzeControls, enrichment-gate.ts:52, and commands.ts RefreshPanel/SelfHealPanel all read them while running:true. The PR's advertised live-progress features (iteration/phase parsing, polled analyze progress) are non-functional; self-heal-live.test.ts passes only because its fixture returns {running:true, output:'...'} — a shape no server code path produces. Fix: switch these three jobs to spawnManaged (llm-client exec.ts:569) with stdio pipe, appending chunks to the singletons as they arrive; spawnManaged also provides kill(), which makes the exec({signal}) addition unnecessary (remove it to avoid a second cancellation mechanism in the foundation tier). Update the test fixtures to a server-producible shape."
---
