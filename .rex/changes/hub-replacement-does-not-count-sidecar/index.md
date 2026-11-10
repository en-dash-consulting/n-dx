---
id: "387dbe3a-de66-4f66-927a-fba75fb95f5d"
type: "change"
title: "Hub replacement does not count Sidecar turns in flight as live work and kills them"
slug: "hub-replacement-does-not-count-sidecar"
intent: "Adversarial review of capture/no-manual-restart (d59c6096c..3e16fdf2f). Verdict: must-fix. gatherHubLiveWork (packages/core/web.js) counts hench locks, dashboard executions and MCP sessions, but not Sidecar sessions with a turn in flight (packages/web/src/server/sidecar/session-registry.ts 'live' map — a vendor CLI spawned by a project server), nor the hub-scope Sidecar session. Trigger: a Sidecar drawer turn running in project B; 'ndx start' in project A finds a stale hub, sees no live work, replaces it; B's server tree is terminated mid-turn and the turn's output is lost. Fix: have project servers (and the hub for hub-scope sessions) report in-flight Sidecar turns beside MCP sessions, and count them in live work."
acceptanceCriteria:
  - "A Sidecar turn in flight in any registered project, or in the hub's own Sidecar, defers the replacement and is named in the note"
  - "Tests cover a project-scope and a hub-scope in-flight turn"
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "medium"
discoveredFrom: {"item":"8c5a1439-ad72-437a-a53f-42b4adc01221"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
