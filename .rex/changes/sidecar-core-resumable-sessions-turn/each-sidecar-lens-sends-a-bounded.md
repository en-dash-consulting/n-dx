---
id: "afc0a661-2cf4-42a6-9bc6-72cfc3e6d3ce"
type: "task"
title: "Each Sidecar lens sends a bounded, deterministic context packet"
slug: "each-sidecar-lens-sends-a-bounded"
description: "Packet builder framework for Sidecar lenses (design §3). A packet is built by code with no LLM call, capped in characters, and stamped per section with provenance (source, generated-at) and staleness; when a section is cut to fit the cap, the packet says what was cut. M1 builds the framework and the builders whose data exists today: Explain (8k: capability statement and capability criteria, derived status and health, linked changes, trailer-commit evidence, sourcevision zone summary for the touched files; on a v1 tree, the epic or feature with its acceptance criteria and the zone), Describe (8k: task text and done-when, parent chain, the --resolve settings with their sources and refusals, a brief preview digest, blockers and dependencies, prior run statuses), and Plan (10k: the product-map slice around the target on v2 or the epic subtree on v1, Inbox and needsPlacement items, recent changes, sibling titles for dedupe). General sends no packet. Guide, Diagnose run, Diagnose branch, Place, Migrate and Hub need data sources that do not exist yet (queue planner, run classifier, branch status collector, Inbox list read, migration plan reads, hub snapshot); register them as unavailable, to be built with those sources. Rex and sourcevision reads go through web's gateways. CAOS story: https://www.notion.so/3f7a80b71924810499c9f380e11f53fd."
acceptanceCriteria:
  - "the Explain, Describe and Plan builders make no LLM call and have snapshot tests on fixture trees, v1 and v2"
  - "each packet respects its cap (Explain 8k, Describe 8k, Plan 10k characters) and names what it cut"
  - "every packet section carries its provenance and staleness"
  - "the General lens sends no packet, and a lens whose data source does not exist yet reports itself unavailable rather than sending a partial packet"
  - "rex and sourcevision reads go through web's rex and domain gateways"
priority: "medium"
source: "caos"
---
