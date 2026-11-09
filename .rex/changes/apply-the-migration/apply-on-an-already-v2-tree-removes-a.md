---
id: "1dc03bda-5534-4dc6-8924-d38acc9826cd"
type: "task"
title: "Apply on an already-v2 tree removes a leftover prd_tree/ only when it matches the plan"
slug: "apply-on-an-already-v2-tree-removes-a"
description: "Review of #689 (2026-10-12), must-fix, CONFIRMED (reproduced; lead reviewer re-read apply.ts:689-694). packages/rex/src/migrations/v1-to-v2/apply.ts:691-695: when product/ exists, applyV1ToV2 removes prd_tree/ and tree-meta.json unconditionally, before a plan is even required (cli/commands/migrate.ts:145-153 skips the plan check when hasV2Tree), assuming only an interrupted apply could have left them.\n\nFailure scenario: migrate a copy, restore prd_tree/ and add a new epic 11111111-… that is not in v2, move the plan away, run 'ndx migrate --apply .'. Output: 'nothing to apply. Removed what an interrupted apply left: …/prd_tree'. The new epic is gone. Reachable on cut day: a v1 branch merged after the cut still carrying prd_tree/ edits ('convert or re-capture'), rex init at this head scaffolding prd_tree/ beside product/, or any v1 write in a crash window. The dry run only says 'Apply would remove what an interrupted apply left'.\n\nFix: remove the leftover only when it is provably what an interrupted apply left: its digest matches the plan's source.digest (or, with no plan, every id in the leftover tree is present in the v2 tree read back from disk). Otherwise refuse, keep prd_tree/, and name the ids not present in v2, pointing at re-capture. The dry run says which case applies."
acceptanceCriteria:
  - "A restored prd_tree/ holding a new epic beside product/, with a plan whose source.digest does not match, is refused, kept on disk, and the refusal names the new epic's id (test; fails at 4646976bad)"
  - "The same case with no plan file is refused and kept (test; fails at 4646976bad)"
  - "A genuine interrupted apply (the leftover matches the plan's source.digest) is still finished: prd_tree/ and tree-meta.json removed (existing test passes)"
  - "--apply --dry-run on each case says whether apply would remove or refuse (test)"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
source: "review-2026-10-12"
blockedBy:
  - "1aba5faa-aa60-4566-a045-928ab6c61795"
---
