---
id: "ff340e13-5e80-472f-a5e0-12b77cfad82a"
type: "task"
title: "Describe a change box pads wrapped text away from its border"
slug: "describe-a-change-box-pads-wrapped"
summary: "Text typed into the Describe a change box keeps a clear margin from the box edge when it runs onto several lines, so it reads cleanly."
description: "Seen in capture-tile-typed.png (integration/plan-analyze-stack @ 7bb07a3d3): once the description wraps to a second line, the text sits flush against the textarea border."
acceptanceCriteria:
  - "The capture textarea has inner padding on all sides that matches the dashboard's other text inputs"
  - "Wrapped multi-line text never touches the border in light or dark theme"
priority: "low"
source: "ndx-capture"
---
