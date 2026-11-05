---
id: "f5c7b061-22b2-4b84-93cd-55793d328d68"
type: "change"
title: "Tune stage: run history, spend and suggestions leave Plan and Work"
slug: "learn-stage-run-history-spend-and"
intent: "Slice S1 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, revision 12; decisions PP3, PP4, PP5, PP7, PP13, TN0, TN3, TN4, AD7, SP1). Built on the Sidecar stack (X1, then C1/C2 when pushed).\n\nThe dashboard gets a fourth stage, Tune, after Work: where a project fine-tunes and refines the ndx workflow for itself and the tools it has. Its question is \"how should this project's workflow change?\". It is built from views that already exist, rendered as tiles the way Analysis is: Runs (with the Execution Log as a tab), Spend (Token Usage), Suggestions (Optimization and Adaptive as tabs of one tile; never \"Tuning\", so the page does not read Tune › Tuning) and Shipped (the PRD Graph, which draws PRD items beside the merge commits that shipped them). New tiles (Outcomes by tier, Your tooling) come in S5; the Sidecar's additions in S8; calibration, similar tasks, proposed rules and verification later.\n\nPlan loses Runs, PRD Graph, All Commands and Requirements. All Commands becomes a Reference tab under Settings › Commands. Requirements becomes a tab of the Product page. Work loses the Execution Log, Token Usage, Optimization and Adaptive. Robot Wrangler and Workflow settings stay in the Settings overlay (TN1). Every view keeps its id and route; moved views get aliases the way /rex-dashboard resolves to /work.\n\nThe Tune tab joins the top nav beside the Sidecar button from the stack (#902), so the UX2′ width tiers need one more step.\n\nThe change amends the navigation capability (d5ad6f16) so its statement and its criteria both describe the four-stage loop (AD7): the old criteria described a SourceVision / Rex / Hench sidebar.\n\nThis revises PW2, PW3 and PW8 of the Plan/Work/Live consolidation plan."
acceptanceCriteria:
  - "The top navigation and the side stage links run Analysis › Plan › Work › Tune, and the side link after Tune goes to Analysis; Live stays outside the loop"
  - "Tune renders Runs (Execution Log as a tab), Spend, Suggestions (Optimization and Adaptive as tabs) and Shipped as tiles, each opening full-screen and through Open ↗ to its own page"
  - "Plan no longer shows Runs, PRD Graph, All Commands or Requirements, and Work no longer shows the Execution Log, Token Usage, Optimization or Adaptive"
  - "Every moved view keeps its view id and route, and old deep links resolve; restored-views and navigation-model tests pass"
  - "Live's finished-run links and the bottom bar's run count open Tune"
  - "With the Sidecar button present, the top nav fits without overflow at 1440, 1200, 1100 and 960 px"
amends: [{"target":"d5ad6f16-156d-496f-99e5-0230dd48cd47","delta":"modified","summary":"Navigation becomes a loop of four stages with Tune; criteria describe the loop","criteria":{"replace":[{"id":"c1","text":"The top navigation shall show the Analysis, Plan, Work and Tune stages in that order."},{"id":"c2","text":"The side stage links shall step through the four stages and wrap from Tune back to Analysis."},{"id":"c3","text":"Live shall appear as its own tab outside the stage loop."},{"id":"c4","text":"Settings shall open as an overlay from the bottom bar, not as a stage."},{"id":"c5","text":"Each stage page shall answer one question: Analysis what the code is, Plan what is changing, Work what goes to the agent next, and Tune how the project's workflow should change."}],"remove":["c6","c7"]},"proposed":"The web dashboard organizes its pages as a loop of four stages (Analysis, Plan, Work and Tune), with Live beside the loop and Settings in an overlay."}]
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
  - "tune"
source: "ndx-capture"
---
