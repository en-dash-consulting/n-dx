---
id: "2ba1d161-bb60-4224-a7d5-aa7bc6b82b5f"
level: "task"
title: "The bare ndx migrate chain shows the preflight banner and its --dry-run runs no model unless asked"
status: "pending"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
blockedBy:
  - "7d0695e3-3ba0-43f5-9662-08b766f66f07"
source: "review-2026-10-12"
acceptanceCriteria:
  - "The bare ndx migrate chain prints the preflight banner on a TTY before the plan step (test; fails at a7f2c007da)"
  - "ndx migrate --dry-run passes --rules-only to rex migrate --plan unless the model-pass flag is given (chain unit test with stubbed spawns; fails at a7f2c007da)"
  - "ndx migrate --help documents that --dry-run runs no model by default and names the flag that turns the passes on"
description: "Review of #691 (2026-10-12), should-fix 5, CONFIRMED by reading (no model calls were run). packages/core/cli.js:1859-1863 and packages/core/migrate-chain.js:133-145: ndx migrate . (the command the deprecation notice names) runs rex migrate --plan with text placement, spec drafting and Jev on by default, then applies the fresh plan with no review stop, and handleMigrate does not use withPreflight. ndx migrate --dry-run . also runs the model passes unless --rules-only is given; the help says only that the chain still writes the plan file.\n\nFailure scenario: on this repository an operator following the notice literally pays for hundreds of model calls and gets an unreviewed apply, while the cut-day plan runs --plan, a review, then --apply.\n\nDecision S2-Q3 (Ryan, 2026-10-12): the bare chain goes through withPreflight (the same banner ndx migrate --plan gets in C1-4, 259bd12c), and ndx migrate --dry-run is rules-only unless a flag asks for the model passes (e.g. --with-models). Help text says so. Keep it minimal."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:24:09.586Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
