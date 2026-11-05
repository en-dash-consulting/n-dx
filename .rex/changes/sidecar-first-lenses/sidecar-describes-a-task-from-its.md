---
id: "9559114b-dfe3-466e-9158-c3bc6c626462"
type: "task"
title: "Sidecar describes a task from its brief, run settings, blockers and history"
slug: "sidecar-describes-a-task-from-its"
description: "Story 17 (CAOS https://www.notion.so/3f7a80b7192481ee9289c4d0f14f3609). M1 left Describe's two Prepare reads as stubs in routes-sidecar.ts: createPacketSources(ctx, { resolve: async () => null, preview: async () => null }). Wire them to the reads the Prepare task modal already uses in routes-hench-prep.ts (ndx work --resolve and --dry-run through its existing seams). The Describe packet carries the task summary, done-when as checks, likely files, the tier with its reason, the resolved run settings, blockers and prior runs. The lens instructions tell the agent to flag vague acceptance criteria and to propose tightened ones through a propose_prd_change change-set card (the card is the change-set card task's). The agent cannot judge a model's answer, so tests check the packet and instructions. Mock: Anatomy board."
acceptanceCriteria:
  - "A Describe packet for a task carries the resolved run settings and the dry-run preview from the Prepare reads, not null (tested)"
  - "The packet carries the task summary, done-when as checks, likely files, and the tier with its reason (tested)"
  - "When a Prepare read fails, the packet says that part is unavailable and the session still starts (tested)"
  - "The Describe lens instructions tell the agent to flag vague acceptance criteria and propose tightened ones through a change-set card (tested)"
  - "With a stub vendor, the Describe packet and instructions reach the session's first turn (tested)"
priority: "medium"
source: "caos"
---
