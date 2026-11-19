---
id: "293a056c-2798-4817-b004-a992c9abf33a"
type: "task"
title: "Analysis shows a loading state instead of Getting Started while data loads"
slug: "analysis-shows-a-loading-state-instead"
summary: "While the analysis is still loading, the page says it is loading rather than telling the user to run an analysis that already exists."
description: "Seen in analysis-dark.png (integration/plan-analyze-stack @ 7bb07a3d3): until the analysis data arrives, the page shows \"Getting Started: complete the analysis\" and \"No inventory loaded\", which reads as if no analysis exists. That empty state should only appear once loading has finished and found nothing."
acceptanceCriteria:
  - "While analysis data is loading, the Analysis page shows a loading state and no Getting Started or 'No inventory loaded' text"
  - "Getting Started still shows once loading finishes with no analysis"
  - "A test covers both the loading and the loaded-empty states"
priority: "medium"
source: "ndx-capture"
---
