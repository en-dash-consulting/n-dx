---
id: "b6fdec97-494e-497a-8dec-07bd399b0e41"
level: "task"
title: "PR template and its test still say GitHub squash-merges PRs"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T17:28:50.761Z"
completedAt: "2026-10-09T17:31:25.731Z"
endedAt: "2026-10-09T17:31:25.731Z"
resolutionType: "code-change"
resolutionDetail: "Reworded PR template comment and commit-trailers test comment to \"merge commit whose body is the PR description\"; no 'squash' left."
acceptanceCriteria:
  - "`.github/pull_request_template.md` says the PR description becomes the body of the merge commit that lands on main; the word 'squash' no longer appears in it"
  - "The comment above the pull-request template test in `tests/unit/commit-trailers.test.js` no longer says 'squash-merge'"
  - "`node_modules/.bin/vitest run tests/unit/commit-trailers.test.js` still passes"
description: "Out-of-scope finding from the adversarial review of \"Document landing through the queue\". The repository lands with merge commits only, whose body is the PR description. `.github/pull_request_template.md:2-3` and the comment at `tests/unit/commit-trailers.test.js:127` still say GitHub copies the description into the \"squash-merge commit message\". CONTRIBUTING.md was corrected in that task, but the task was scoped to CONTRIBUTING.md and RELEASING.md. Effect: contributors read the template comment, which contradicts CONTRIBUTING's \"never squash\" rule. There is no runtime failure. Fix: reword both comments to \"merge commit whose body is the PR description\". The cost is a two-line doc edit with no risk. Verdict: out-of-scope (pre-existing wording); it is worth a small follow-up."
lastModified: "2026-10-09T17:31:25.995Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
