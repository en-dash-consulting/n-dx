---
id: "2e44fcd6-f576-4d6f-8a43-4fade67b4d32"
type: "change"
title: "Work sets review fixes: a reused branch name starts empty, and a blocked set says what blocks it (#1010)"
slug: "work-sets-review-fixes-a-reused-branch"
intent: "Hal's two inline review comments on #1010 (2026-11-09), both confirmed against the code. Follow-up to changes d20fbfb8 and 84d82d83 (branch work sets, P2-1), which are applied. (1) packages/rex/src/core/work-set.ts:199: readWorkSet's hasAssignments counts completed rows and nothing clears `delivery` when a branch merges (by design: after merge it is provenance), so a branch cut later under the same name inherits a finished set; `ndx work` and `rex next` then say \"Nothing left in this branch's work set\" while `rex branch show` says the branch has none. (2) packages/hench/src/agent/planning/brief.ts:397: when the set still holds open units selection cannot pick (blocked by a task outside the set, an Inbox change awaiting placement, claimed elsewhere), WorkSetExhaustedError reports it as finished and `ndx work --loop` exits 0; `rex next` and `get_next_task` say the same. Decision made with this fix (2026-11-09, open to Ryan's review): assignments already on the default branch at this branch's fork point belong to an earlier use of the name and are not in this branch's set; a set finished on this branch still narrows selection (BW3) and says it is finished; a set with open but unpickable units says which and why."
acceptanceCriteria:
  - "A branch cut under a merged branch's name has no work set, and `rex branch show`, `rex next`, `get_next_task` and `ndx work` agree about it"
  - "A work set whose open units cannot be picked is reported as blocked, naming each unit and why, never as finished"
touches:
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
priority: "high"
discoveredFrom: {"item":"d20fbfb8-af73-4dba-9fea-e514cc253512"}
source: "ndx-capture"
---
