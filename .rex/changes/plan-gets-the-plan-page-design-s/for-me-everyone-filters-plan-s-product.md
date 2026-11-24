---
id: "034a93c8-153c-4319-8f1d-ce0b11dac0ff"
type: "task"
title: "For me / Everyone filters Plan's product areas and Inbox"
slug: "for-me-everyone-filters-plan-s-product"
summary: "A 'For me / Everyone' toggle narrows Plan's product areas and Inbox to the work assigned to you, so a team member sees their own queue without setting up filters."
description: "Design: the Inbox column carries a segmented 'For me / Everyone' control in Team mode. Reuse the assignee identity rules ('Mine' as ndx work --mine resolves it, matched by email: components/assignee-model.ts, usePeople) rather than a new notion of 'me'. Applies to the Product areas boxes (changes whose own or open-task assignee is you) and the Inbox side panel. Default: Everyone; the choice is remembered in the browser."
acceptanceCriteria:
  - "A 'For me / Everyone' control filters the Product areas boxes to changes assigned to you (own or open-task assignee)"
  - "The same control filters the Inbox side panel's rows"
  - "'Me' uses the same identity match as the assignee filter and ndx work --mine (unit test)"
  - "The choice is remembered per browser, and an empty result says nothing is assigned to you"
priority: "medium"
source: "ndx-capture"
---
