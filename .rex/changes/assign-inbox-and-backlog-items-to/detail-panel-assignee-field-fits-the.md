---
id: "cc96fe22-050c-42ce-a4e2-fa7bdc6a0e79"
type: "task"
title: "Detail panel assignee field fits the full name and has right-sized buttons"
slug: "detail-panel-assignee-field-fits-the"
summary: "The assignee box in an item's detail panel is wide enough to read the whole name and email, and its Save, Unassign and Cancel buttons match the size of the panel's other controls."
description: "Seen in detail-panel.png (integration/plan-analyze-stack @ 7bb07a3d3): the assignee input only shows the tail \"&lt;email&gt;\" of \"Name &lt;email&gt;\", and the Save / Unassign / Cancel buttons beside it are oversized compared with the rest of the panel."
acceptanceCriteria:
  - "The assignee input takes the remaining row width and a typical 'Name <email>' value is fully visible at the default panel width"
  - "The Save, Unassign and Cancel buttons use the panel's small button size"
  - "At phone width the input and buttons wrap without horizontal scroll"
priority: "medium"
source: "ndx-capture"
---
