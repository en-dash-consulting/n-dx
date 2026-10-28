---
id: "fb0b3070-5a37-4772-9c17-0564a0c2a547"
type: "change"
title: "Place Inbox changes: rex exposes placement and records new-node proposals"
slug: "place-inbox-changes-rex-exposes"
intent: "PR 1 of 5 for issue #873 (the v2 Inbox can't be found or placed from the dashboard, so Inbox changes block ndx work). Design, mocks and decisions IB1–IB11: https://claude.ai/artifact/PS6Jg1NgsJ2a6nidJx4HBm (local copy: ~/ndx-core/local-design-workshop/docs/analysis/inbox-placement/index.html).\n\nRex already ranks placements (`suggestPlacement`) and records them (`recordPlacement`) in `packages/rex/src/core/change-place.ts`, and the CLI (`rex change place`) and MCP (`place_change`) use them. Two gaps block a dashboard: neither function is exported from `packages/rex/src/public.ts`, and nothing can record a new capability or constraint for an existing change when nothing on the map fits. A `PlacementProposal` (an `added` amendment with `type`, `under` an area, and `title`; `core/placement.ts`) is produced only by the placement model and consumed only by the v1→v2 migration.\n\nThis change makes placement reachable from other packages and adds a proposal path to every rex surface, so the dashboard PRs that follow call the same core as the CLI and MCP. Nothing is auto-accepted: a proposal is an `added` amendment on the change and reaches the map only when the change is applied.\n\nDecisions that apply (accepted 2026-10-27): IB5 strength thresholds strong ≥10, possible 6–9, weak ≤5, defined once in rex; IB6 a proposal may go under any live area."
acceptanceCriteria:
  - "`suggestPlacement`, `recordPlacement`, `ChangePlacementError` and their types are exported from @n-dx/rex's public entry point"
  - "A placement suggestion carries `tied` and a `strength` per candidate, from thresholds defined once in rex"
  - "An open Inbox change can be given a proposed new capability or constraint under a live area from the CLI and from MCP, which clears needsPlacement and leaves the map unchanged until the change is applied"
  - "ndx work's Inbox refusal names the dashboard's Inbox as well as the CLI and MCP commands"
  - "Changeset bumps @n-dx/rex and @n-dx/hench as patch"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
  - "70443075-8352-48a4-a8ed-799505872d4b"
  - "5cfa1d83-839a-47a1-ae42-4353cd1acf83"
priority: "high"
tags:
  - "inbox-placement"
  - "issue-873"
  - "rex"
  - "hench"
source: "ndx-capture"
---
