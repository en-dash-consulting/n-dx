---
id: "0239df47-553b-4d0d-b3b4-5ba9ee84c9af"
level: "task"
title: "Code-owner files go stale after a stewards edit until someone re-runs rex codeowners"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-25"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With codeOwners: true, changing an area's stewards through the v2 write path updates CODEOWNERS and .bitbucket/CODEOWNERS, or a validation step fails naming the stale file (test)"
  - "With codeOwners unset, no write path creates or changes either file (test)"
description: "Verdict: should-fix (follow-up). Scenario: a project has opted in (`codeOwners: true`). A steward edits `stewards` on `product/index.md` or on an area, through a product-edit apply or by hand. CODEOWNERS and .bitbucket/CODEOWNERS keep the old owners until someone runs `rex codeowners`. Only `rex codeowners --check` in CI catches the drift. Evidence: packages/rex/src/cli/commands/codeowners.ts is the only writer, and no v2 write path calls it. The v2 loader is not wired into a store yet, so there is no write path to hook today. Reachable once the v2 store lands.\n\nOptions:\n(a) Call the planner from the v2 tree writer after a write that changes any `stewards`, when opt-in is on. This keeps the files current, but code-owner writes would then happen outside the store.\n(b) Have `ndx ci` / validate run the equivalent of `--check`. This is cheap and makes drift loud, but it is still manual.\n\nRecommend (b) now, and (a) once the v2 store wires in."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-09T14:52:34.967Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
