---
id: "1de3f2ff-1311-4592-8b54-dc44187df8f9"
type: "task"
title: "Plan tiles keep their order while the page loads"
slug: "plan-tiles-keep-their-order-while-the"
summary: "The Plan page's tiles appear in their final positions from the first paint, instead of landing in one order and rearranging once data arrives."
description: "Seen while capturing the integration screenshots (integration/plan-analyze-stack @ 7bb07a3d3): during load the Plan tiles render in a different order and then jump into place, so the Describe a change tile and Inbox shift under the pointer."
acceptanceCriteria:
  - "Each Plan tile renders in its final slot from the first paint, with a placeholder while its data loads"
  - "A test asserts the tile order in the loading state matches the order once data has loaded"
priority: "medium"
source: "ndx-capture"
---
