---
id: "4c1943bc-ea12-44ca-bd8c-2ea05aa9b938"
type: "task"
title: "Dashboard Mine can disagree with ndx work --mine"
slug: "dashboard-mine-can-disagree-with-ndx"
summary: "The dashboard can show work as yours that the 'work on my items' command will never pick up, because they compare names differently. This makes picking yourself save the exact identity the command uses."
description: "Verdict: should-fix (severity medium), from the adversarial review of feat/assignee-picker-mine-filter (e65d38c9f).\n\nThe CLI matches assignee exactly (=== against resolveActor's 'Name <email>', rex/src/core/change-selection.ts:132, next-task.ts:446); the dashboard isMine compares only the email key (packages/web/src/viewer/components/assignee-model.ts:41-55), and `me` is never added to the people list (server/routes-rex/people.ts:198-220, 266-277). Triggers: (a) item assigned 'ann@shop.io' or 'Ann L <ann@shop.io>' while me is 'Ann Lee <ann@shop.io>' — dashboard shows it under Mine, ndx work --mine never selects it (assignee-views.test.ts encodes this case); (b) picking yourself saves the git-shortlog spelling with the most commits — this repo has 'nick daniel' (55) beside 'Nick Daniel' (958) and 'sterling.h@endash.us <sterling.h@endash.us>' (92) beside 'Sterling H' (951); (c) a user with no commits types their email and saves a bare email the CLI never matches.\n\nFix (recommended, cheap, low risk): add `me` to mergePeople as the highest-priority entry so its exact resolveActor id wins for its email key; picking or typing yourself then saves the CLI's string. Optional: flag rows that match me by email but not exactly ('not matched by ndx work --mine'). Larger alternative: make rex --mine compare by email (cross-package)."
acceptanceCriteria:
  - "The people list includes the current user with the exact identity ndx work --mine matches, and that entry wins over other spellings of the same email"
  - "Picking yourself, or typing your own email, saves the exact identity ndx work --mine matches"
  - "An item assigned to the current user's email under a different spelling is shown as not matched by ndx work --mine"
  - "Tests cover the three triggers"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
