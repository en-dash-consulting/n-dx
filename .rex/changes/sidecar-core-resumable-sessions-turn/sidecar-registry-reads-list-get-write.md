---
id: "7961018b-a81d-4b39-9bdb-fe54d0b81c28"
type: "task"
title: "Sidecar registry reads (list/get) write index.json when the idle TTL expires"
slug: "sidecar-registry-reads-list-get-write"
description: "Verdict: should-fix (low). packages/web/src/server/sidecar/session-registry.ts: list() and get() call sweep(), which rewrites <henchDir>/sidecar/index.json whenever a session has idled past the TTL. Scenario: a session idles 2 h, then the sessions list is fetched → the read writes index.json. Once story 03 routes GET /api/sidecar/sessions (and GET …/frames) through these methods, a GET writes a file, breaking the src/server/AGENTS.md rule \"GET must be read-only\". Not reachable today: the registry is not routed yet. Options: (1, recommended) make reads apply the TTL in memory (report resumeId as absent when expired) and persist only from writing paths (create, sendTurn, end) — small change, keeps the TTL visible on reads; (2) leave the sweep on reads and exempt it in the rule — cheaper but erodes a security rule."
acceptanceCriteria:
  - "list() and get() on a registry whose session has idled past the TTL report no resume id and leave index.json byte-identical"
  - "the next sendTurn on that session starts a fresh vendor session and persists the forgotten id"
  - "a test in packages/web/tests/unit/server/sidecar-session-registry.test.ts covers both"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
