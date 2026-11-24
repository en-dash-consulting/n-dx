---
id: "9b482f7e-2536-4060-a709-66ba43c4cbb6"
type: "change"
title: "Plan drops the lifecycle counts and shows product areas as even, clickable boxes"
slug: "plan-drops-the-lifecycle-counts-and"
summary: "Plan no longer shows the row of Inbox, Proposed, Ready, In progress and Awaiting apply counts. The product-area boxes line up at one height, open their area when clicked, and show only the first three lines of each summary, fading out the rest."
intent: "Follow-up to the Plan/Work redesign (ede1af70) from reviewing it on the dashboard. The lifecycle band (How work moves on Create, Lifecycle on Preparation) repeats what the side panels and glance cards already carry. The Product areas grid grows unevenly because each box is as tall as its summary and change list, and only the area's name opens it."
acceptanceCriteria:
  - "Plan shows no lifecycle counts band on either mode"
  - "Every Product areas box in a row has the same height, opens its area on click or Enter, and shows at most three lines of summary"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
discoveredFrom: {"item":"ede1af70-6110-418a-b91d-536149a008b4"}
source: "ndx-capture"
---
