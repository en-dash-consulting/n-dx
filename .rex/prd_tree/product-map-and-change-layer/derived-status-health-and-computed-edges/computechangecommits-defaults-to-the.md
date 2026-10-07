---
id: "5037ef60-189f-4393-9618-cb2be8e8e72b"
level: "task"
title: "computeChangeCommits defaults to the local main branch, which a CI checkout lacks and a worktree may hold stale"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-07T22:24:05.440Z"
completedAt: "2026-10-07T22:29:57.794Z"
endedAt: "2026-10-07T22:29:57.794Z"
acceptanceCriteria:
  - "In a fixture clone that has origin/main but no local main branch, computeChangeCommits with no ref returns the trailer commits on origin/main instead of throwing (test)"
  - "In a fixture where local main is behind origin/main, the default resolution returns the commits merged on origin/main (test)"
  - "An explicitly passed ref still overrides the default (test)"
description: "Verdict: should-fix (from the adversarial review of e50d9c97). `packages/rex/src/core/change-commits.ts` sets DEFAULT_MAIN_REF = \"main\" and resolves it with `git rev-parse --verify main^{commit}`.\n\nFailure scenarios:\n- A CI checkout of a PR (actions/checkout of the PR head) has no local `main` branch, only `origin/main` at best. `computeChangeCommits` throws \"git rev-parse failed\".\n- A long-lived clone whose local `main` was never fast-forwarded (every worktree shares one local `main`) answers from a stale tip. Commits merged on `origin/main` since then are silently missing, so realized-by and landing (52f22b65) would report work as not landed.\n\nReachability: no caller is wired yet. Realized-by (97adaba2) and landing (52f22b65) will be the first, so this should be decided before they land.\n\nOptions:\n- (a) Resolve the default as `origin/HEAD`, then `origin/main`, then `main`. Small and local; the risk is that a stale remote-tracking ref still needs a fetch.\n- (b) Require callers to pass the ref and read it from project config, e.g. `rex.mainRef` in `.n-dx.json`. Explicit and host-neutral, but it adds a config key.\n\nRecommendation: (a), with (b) as an override. The choice of default is the maintainer's decision.\n\nDecision (2026-10-07, Ryan): option (a). With no ref passed, resolve the default as origin/HEAD, then origin/main, then main, using the first that exists. An explicitly passed ref always overrides the default. Do not add a rex.mainRef config key."
lastModified: "2026-10-07T22:29:58.041Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
