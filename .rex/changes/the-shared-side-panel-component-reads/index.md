---
id: "36d64119-c7ef-44e1-9b23-5b1d0a9147d1"
type: "change"
title: "The shared side-panel component reads Plan's Solo / Team state to title the Inbox"
slug: "the-shared-side-panel-component-reads"
summary: "The side panels used by both Plan and Work looked up Plan's Solo or Team setting themselves; Plan now tells them the title instead, so the shared part stays independent of any one page."
intent: "Finding 5 of the adversarial review of 86c16eb90..9e5d17073 (low, first judged not worth fixing; the user asked for it). stage-side-panels.ts imports usePlanView to swap in a `soloTitle` from the stage config, so a generic component, also used by Work, depends on Plan's view state, and StageSidePanel (stages.ts) carries a Plan-only field. Fix: StageSidePanels and StagePage take an optional `titleOf(panel)`; Plan's page (a PlanStagePage wrapper in the registry) supplies it from plan-view-state, and `soloTitle` leaves the stage config."
acceptanceCriteria:
  - "stage-side-panels.ts no longer imports plan-view-state"
  - "StageSidePanel has no soloTitle field; the Solo title lives with Plan's code"
  - "Plan's Inbox panel is still titled 'Your inbox' in Solo and 'Inbox' in Team, with a test"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "low"
discoveredFrom: {"item":"9e87cb29-be37-4d69-b4b5-5f771e520424"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
