---
id: "52f22b65-41da-400a-84ee-258ee32de765"
level: "task"
title: "Work out when a change landed from git history"
status: "pending"
priority: "medium"
tags:
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
  - "host-neutral"
blockedBy:
  - "e50d9c97-8cf6-409b-b9bb-c6d00f832599"
  - "47e43846-b305-4b39-bd0f-274efd72b0dc"
source: "roadmap"
acceptanceCriteria:
  - "A fixture repository with a merge-commit merge and a fast-forward merge reports the right landing commit for each (test)"
  - "A squash-merged fixture reports the change as not reachable from main, with the reason (test)"
  - "No code path reads merge-commit message text to decide whether or when a change landed"
  - "A rebased appliedIn whose twin is on main reports the twin's landing commit, not 'not landed' (test)"
description: "Host-neutral rule: nothing may depend on how GitHub or Bitbucket word a merge commit (Bitbucket's default merge message omits the PR description). Compute when a change landed on main from git alone: the first-parent merge commit on main whose merged branch contains the change's appliedIn commit (or the change's last task commit for touches-only changes); with fast-forward merges, the first main commit that contains it. Expose it as a computed value beside the other edges, cached under .ndx/rex/.cache, and use it as the fallback for shippedIn (first release tag containing the landing commit) when no stamp exists. If the commit is not reachable from main (a squash or rebase merge), return 'not landed' with that reason; rex health reports it. Read the change's commits through the trailer lookup, and before reporting 'not landed' try the re-point: a rebased appliedIn whose twin is on main has landed."
lastModified: "2026-10-07T21:28:30.149Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
