---
id: "c5b1bbf2-6528-40f9-94bc-f504cd9d05b0"
type: "task"
title: "Sidecar proposes a run plan card with the exact ndx work commands"
slug: "sidecar-proposes-a-run-plan-card-with"
description: "Guide lens (story 21) over R1's queue planner (ndx work --plan-queue --format=json) and a run-plan card through a new never-allow-listable broker tool. Design §5 Guide (Q4), §7 Run plan."
acceptanceCriteria:
  - "LENS_PACKETS.guide is a packet with a 6k cap whose body is the planner's QueuePlan (lanes with command and reasons, excluded tasks with reasons, activeRuns and runLimit, summary), read the way GET /api/hench/plan-queue reads it, with no node:child_process in web"
  - "Guide's target is the ready list as a whole (Live attaches it; no ref needed); with an empty ready list the packet says so and the instructions forbid a run-plan card"
  - "While hench.readyNext is off, GET /api/sidecar/lenses reports guide unavailable with needs naming hench.readyNext, and no packet is built and no planner is spawned (tested)"
  - "A new broker tool propose_run_plan raises a run-plan card and is never allow-listable; the card lists each lane with its exact ndx work command"
  - "The card's Copy commands copies every lane command without a broker call and without starting anything (tested)"
  - "The card's Start lane raises one start_work card per lane; nothing starts without an approved work card, and the plan never auto-runs"
  - "The work card shows active runs against the limit of three, and approving a start that would make a fourth run is refused with that reason (tested)"
source: "ndx-capture"
---
