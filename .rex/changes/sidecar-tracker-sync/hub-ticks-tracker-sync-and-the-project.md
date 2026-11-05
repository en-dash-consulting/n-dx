---
id: "bce137b2-541b-4d20-b978-8518eec4838d"
type: "task"
title: "Hub ticks tracker sync and the project server collects ndx events"
slug: "hub-ticks-tracker-sync-and-the-project"
description: "Story 45, part 2. Event sources the project server collects since its last tick: a hench run starting a linked task (run records), PR opened carrying the item's N-DX-Item trailer and PR merged (gh through the llm-client exec helpers, behind the existing GitHub-reads allowance), release published (the Version Packages merge / tag), and a task's run failing twice (run records and the diagnosis class). Each event is queued once (a cursor per source; a restarted server does not re-emit). The hub's src/hub/tracker-sync.ts ticks each registered project whose trackerSync has a rule not off, every 5 minutes and on project-server start, through the proxy with the per-user token; a project server that is down is skipped until healthy. Exec in the hub only through hub/exec-gateway.ts (likely none needed). Follow the shared rules in the parent change's description."
acceptanceCriteria:
  - "Each event source emits its event once for a fixture project (run start, PR opened with trailer, PR merged, release published, two failed runs) and not again after a restart (tests with fixtures and a fake gh)"
  - "The hub ticks only projects with a rule not off, skips an unhealthy server, and sends the per-user token through the proxy (hub tests)"
  - "src/hub/ imports nothing from src/server/ or src/viewer/ (the existing H1 test passes)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
