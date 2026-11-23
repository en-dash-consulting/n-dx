---
id: "546f2519-2451-44b7-a579-2580cc1d7f14"
type: "task"
title: "Remove the lifecycle counts band from Plan"
slug: "remove-the-lifecycle-counts-band-from"
summary: "Take the row of Inbox, Proposed, Ready, In progress and Awaiting apply counts off both Plan modes; the Inbox count and rex's next pick are already shown elsewhere on the page."
description: "The band is the `flow` panel (LifecycleStrip) placed as `How work moves` on Create and `Lifecycle` on Preparation in views/stages.ts. Remove both placements; keep the component if another view still uses it, otherwise remove it with its tests. The Inbox side-panel tab already shows the open Inbox count, and the 'What's next for the product' card shows rex's next pick."
acceptanceCriteria:
  - "Plan › Create no longer shows How work moves (Inbox, Proposed, Ready, In progress, Awaiting apply, Next)"
  - "Plan › Preparation no longer shows the Lifecycle band"
  - "The Inbox count stays on the Inbox side-panel tab, and rex's next pick stays on the 'What's next for the product' card"
  - "Layout tests assert Plan's bands no longer include the lifecycle panel"
priority: "medium"
source: "ndx-capture"
---
