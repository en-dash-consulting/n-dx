---
id: "f5c7b061-22b2-4b84-93cd-55793d328d68"
type: "change"
title: "Learn stage: run history, spend and tuning leave Plan and Work"
slug: "learn-stage-run-history-spend-and"
intent: "Slice S1 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, decisions PP3, PP4, PP5, PP7, PP13).\n\nThe dashboard gets a fourth stage, Learn, after Work: \"What happened, and what should change?\" It is built from views that already exist, rendered as tiles the way Analysis is: Runs (with the Execution Log as a tab), Spend (Token Usage), Tuning (Optimization and Adaptive as tabs of one tile) and Shipped (the PRD Graph, which draws PRD items beside the merge commits that shipped them). The predictive tiles (calibration, similar tasks, proposed rules, verification) come later as their data does.\n\nPlan loses Runs, PRD Graph, All Commands and Requirements. All Commands becomes a Reference tab under Settings › Commands. Requirements becomes a tab of the Product page, since requirements are intent attached to product nodes. Work loses the Execution Log, Token Usage, Optimization and Adaptive. Every view keeps its id and route; moved views get aliases the way /rex-dashboard resolves to /work.\n\nThis revises PW2, PW3 and PW8 of the Plan/Work/Live consolidation plan, which parked run history and results at the bottom of Work until Learn existed."
acceptanceCriteria:
  - "The top navigation and the side stage links run Analysis › Plan › Work › Learn, and the side link after Learn goes to Analysis; Live stays outside the loop"
  - "Learn renders Runs (Execution Log as a tab), Spend, Tuning (Optimization and Adaptive as tabs) and Shipped as tiles, each opening full-screen and through Open ↗ to its own page"
  - "Plan no longer shows Runs, PRD Graph, All Commands or Requirements, and Work no longer shows the Execution Log, Token Usage, Optimization or Adaptive"
  - "Every moved view keeps its view id and route, and old deep links resolve; restored-views and navigation-model tests pass"
  - "Live's finished-run links and the bottom bar's run count open Learn"
amends: [{"target":"d5ad6f16-156d-496f-99e5-0230dd48cd47","delta":"modified","summary":"Navigation becomes a loop of four stages with Learn","proposed":"The web dashboard organizes its pages as a loop of four stages (Analysis, Plan, Work and Learn), with Live beside the loop and Settings in an overlay."}]
touches:
  - "d7f5ba08-a413-44f2-a560-0423be6b4413"
  - "6f8afa48-7f03-4faa-82de-81af5c7db69e"
  - "a32f8a34-2c34-4ea1-9652-d85d0ba4e8d2"
  - "a19a8bac-6c65-4590-b2b7-543d9e01843c"
priority: "high"
tags:
  - "web"
  - "dashboard"
  - "plan-page-redesign"
  - "learn"
source: "ndx-capture"
---
