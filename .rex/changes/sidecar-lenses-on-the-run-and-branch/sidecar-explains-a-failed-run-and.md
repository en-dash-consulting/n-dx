---
id: "2914d715-6f3b-4183-95f2-5ce8f6acd8c0"
type: "task"
title: "Sidecar explains a failed run and offers the next action on a card"
slug: "sidecar-explains-a-failed-run-and"
description: "Diagnose run lens (story 19) over R1's run classifier (RunRecord.diagnosis, hench runs diagnose), the run's gate digest and its review report. Registers the lens as a packet in lens-packets.ts. Design §5 Diagnose run (Q5)."
acceptanceCriteria:
  - "LENS_PACKETS['diagnose-run'] is a packet with an 8k cap, built in packet-builders.ts from a read in packet-sources.ts that goes through the web gateways"
  - "The attached task is the target: the packet reads its newest run and has sections, each with provenance, for the classifier verdict (class, evidence, ranked actions, attempt k of 2), the gate digest tail (capped), the review findings (must-fix and unrepaired) and the last events"
  - "With no task attached the lens is unavailable and names 'a task to diagnose'; with a task but no diagnosed run the packet carries a gap section naming 'hench runs diagnose <id>'; neither case sends another lens's packet"
  - "DIAGNOSE_RUN_INSTRUCTIONS require every claim to be labelled tested, inspected, not met or not verified with the packet section it rests on, and actions in the classifier's §5 Q5 order"
  - "At attempt 2 of 2 the instructions require 'attempt 2 of 2: next is a fix or a split' and forbid offering a re-run or --fresh"
  - "Verify-and-close and a follow-up or split go through propose_prd_change (change-set card); re-run goes through start_work (work card); --fresh goes through start_work with fresh set, and the work card's resolve preview shows --fresh"
  - "The builder's comment and a docs/ page state that including the gate digest is a deliberate exception to 'knowledge packets omit error text' (PK4): it is local and goes only to the configured vendor; packages/web AGENTS.md files gain no lines"
  - "Snapshot tests on the builder cover a fixture run for each of: new test failure, pre-existing failure, review blocked, completion held, no changes, and an attempt-2-of-2 run"
source: "ndx-capture"
---
