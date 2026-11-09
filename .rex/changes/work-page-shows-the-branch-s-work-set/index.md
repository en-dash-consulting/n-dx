---
id: "1d9ec823-10c5-4a4b-86d2-b17335e0a662"
type: "change"
title: "Work page shows the branch's work set, with Add, Remove and Start a branch"
slug: "work-page-shows-the-branch-s-work-set"
intent: "Phase P2-2 of the change, task and branch design (workshop analysis/change-task-branches/README.md §3, decisions BW1–BW7; PR breakdown p2-pr-breakdown.md, table 'PR P2-2'; D3 decided 2026-11-06). P2-1 (change d20fbfb8, PR #1010) recorded a branch's work set as `delivery: { branch }` per task in state.yaml, inherited from a change by its tasks that have none, and made `ndx work` and get_next_task pick only from it (`--any` overrides). A branch has a work set only once some item names it; the default branch and a detached HEAD never do. This change puts the work set on the dashboard's Work page: 'On this branch' first, grouped by change, with Remove; 'Not on a branch' below, with Add; Ready to run and Start narrowed the same way `ndx work` narrows; and a 'Start a branch' dialog that names a new branch from the first selected change's slug. D3 as built here: when the served checkout is clean and no run is active, the branch is created, switched to, given the selected changes and committed; otherwise the branch is only created and the user is told how to switch. Recording an assignment on a branch that is not checked out is out of scope (it would need commits without a checkout). The mirror and cross-branch views are P2-3."
acceptanceCriteria:
  - "On a branch with a work set, Work shows 'On this branch' first, grouped by change, with Add and Remove, and 'Not on a branch' below."
  - "On main and on a branch with nothing assigned, Work looks as it does today."
  - "Ready to run and Start follow the same filter as `ndx work`."
  - "'Start a branch' creates a branch named from the first change's slug, and never switches a dirty checkout or one with an active run."
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
priority: "high"
source: "ndx-capture"
---
