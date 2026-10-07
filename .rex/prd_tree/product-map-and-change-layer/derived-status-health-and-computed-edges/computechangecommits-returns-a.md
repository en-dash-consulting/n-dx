---
id: "aeb95776-a510-49ec-a8d6-1345c30a39f8"
level: "task"
title: "computeChangeCommits returns a truncated commit list from a shallow clone without saying so"
status: "in_progress"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-07T22:32:28.295Z"
acceptanceCriteria:
  - "In a fixture created with `git clone --depth 1`, computeChangeCommits with no ref throws (or reports truncation) instead of returning a partial list (test)"
  - "The error names the shallow clone and how to deepen it (`git fetch --unshallow` or fetch-depth: 0)"
  - "A full clone behaves as before (existing change-commits tests stay green)"
description: "Verdict: should-fix (adversarial review of 5037ef60, the change that made origin/HEAD then origin/main the default ref).\n\nFailure scenario: CI checks out with actions/checkout at its default fetch-depth of 1, or fetches origin/main shallowly. origin/main now resolves, so `scanTrailerCommits` (packages/rex/src/core/change-commits.ts) runs `git log <tip>` over the shallow history and returns only the commits inside the fetched depth. A change whose commits are older than the shallow boundary gets no commits back, and nothing reports it, so realized-by (97adaba2) and landing (52f22b65) would show merged work as not landed. A trailer cache built in that state is keyed by tip only, so it keeps serving the truncated list until the tip moves.\n\nReachability: no caller is wired yet. Realized-by and landing are the first. Before 5037ef60 a CI checkout usually failed loudly because it had no local main; the new default makes it resolve, which is what exposes the silent truncation.\n\nOptions:\n- (a) Check `git rev-parse --is-shallow-repository` before scanning and throw an error that names `git fetch --unshallow`. Small and loud. Risk: CI jobs must fetch full history (fetch-depth: 0).\n- (b) Return the commits with a `truncated: true` flag and let callers mark results as partial. Not fatal, but it changes the return shape and every caller has to handle the flag.\nRecommendation: (a). Callers that can accept partial data can opt in later.\n\nDecision (2026-10-07, Ryan): option (a). Check git rev-parse --is-shallow-repository before scanning and throw an error that names the shallow clone and how to deepen it (git fetch --unshallow, or fetch-depth: 0 in CI). No truncated flag on the return shape."
lastModified: "2026-10-07T22:32:28.538Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
