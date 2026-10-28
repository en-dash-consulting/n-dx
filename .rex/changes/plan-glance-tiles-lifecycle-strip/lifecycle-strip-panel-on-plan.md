---
id: "21dc372a-cf64-4436-988e-cfc50de92949"
type: "task"
title: "Lifecycle strip panel on Plan"
slug: "lifecycle-strip-panel-on-plan"
description: "A new StagePanelId `flow`, full width under the capture bar: Inbox, Proposed, Ready, In progress and Awaiting apply counts, then the next pick. Each count is a link (Inbox to the Inbox page, the others to Open changes filtered to that stage). Ready at 0 shows \"needs an automated requirement · rex ready\". The next pick shows the title and rex's reason and links to Work with that item selected; it has no Start control. On v1 the strip reads Pending, In progress and Next."
acceptanceCriteria:
  - "The strip shows the five stage counts and the next pick from the summary read"
  - "Each count navigates to its filtered list, and the next pick opens Work with that item selected"
  - "Ready at zero explains how an item becomes ready"
  - "The strip has no Start or Run control"
  - "It wraps to two rows at phone width without horizontal scroll"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "231adb0e-64e8-401c-91ed-c6ca8e30f5ad"
---
