---
id: "bce8e5c6-4ab5-47e1-8d15-9667a7be6392"
type: "change"
title: "Point the Home worktrees pill and the bottom-bar analysis and stuck-run badges at Live"
slug: "point-the-home-worktrees-pill-and-the"
intent: "Three existing indicators should lead to the new pages. The Home floating pill (`viewer/components/sessions-panel.ts`, \"N worktrees · M running\") links to `/live` and reads \"M running · K analysis\" when something is live. On the bottom bar (`viewer/components/status-indicators.ts`), `SvFreshnessIndicator` reads \"Analyzing · phase N of 6\" while an analyze runs and links to `/live/analyze`, and `HenchActivityIndicator`'s \"N stuck run(s)\" links to `/live`. Existing tooltips and states otherwise stay as they are."
acceptanceCriteria:
  - "Each of the three indicators navigates to the matching Live page."
  - "The freshness badge shows the analyze phase during a run and returns to its normal state afterwards."
  - "Existing indicator tests pass with the new links."
touches:
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "low"
tags:
  - "live"
  - "web-viewer"
blockedBy:
  - "dfb31a58-442b-4ee2-bbff-d2b0b0e58419"
  - "da9227aa-3b7a-449f-80af-a99f94975c1a"
---
