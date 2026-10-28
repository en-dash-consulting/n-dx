---
id: "1591411c-4f94-4956-bcb7-cb7935677015"
type: "task"
title: "Inbox count on the Plan tab and bottom bar; Needs placement only on open changes"
slug: "inbox-count-on-the-plan-tab-and-bottom"
description: "Show the open Inbox count from `rex.inbox.open` (/api/status via `useProjectStatus`) as an orange count on the Plan stage tab and as an \"Inbox N\" pill in the bottom bar (`components/bottom-bar.ts`), beside the completion figures. The pill opens the Inbox view. Hide both at zero and on v1.\n\nIn `views/changes.ts`, show the \"Needs placement\" tag only when the row has `awaitsPlacement` (open and held), and make it open the change's detail panel. Applied changes lose the tag (156 on this repo)."
acceptanceCriteria:
  - "Plan tab and bottom bar show the open Inbox count on v2 and nothing at zero or on v1"
  - "The pill opens the Inbox view"
  - "Changes shows Needs placement only on open held changes, and it opens the detail panel"
  - "Unit tests cover the counts and the tag"
priority: "medium"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
