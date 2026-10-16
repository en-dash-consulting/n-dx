---
id: "5fc180fd-0060-409f-98aa-8e0e429b54f1"
level: "task"
title: "Apply rewrites v1 blockedBy refs to and from capabilities onto their open changes"
status: "in_progress"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
blockedBy:
  - "1aba5faa-aa60-4566-a045-928ab6c61795"
source: "review-2026-10-12"
startedAt: "2026-10-16T02:34:34.681Z"
acceptanceCriteria:
  - "A v1 task blockedBy a feature that becomes a capability is, after apply, blockedBy that capability's open changes; with none open the ref is dropped and reported (fixture test; fails at 4646976bad)"
  - "A v1 feature->feature blockedBy (both capabilities) moves onto each open change of the blocked capability, pointing at the other capability's open changes; no product node keeps a blockedBy (fixture test; fails at 4646976bad)"
  - "--apply --dry-run lists every blockedBy rewrite and drop, including the dissolved-container repoint, with old and new refs (test)"
  - "Apply on a copy of this repository's v1 PRD from a rules-only plan leaves no ref-resolves error in rex health (verified on a scratch worktree copy)"
description: "Review of #689 (2026-10-12), must-fix, CONFIRMED (rex health on a migrated copy; lead reviewer: 43 ref-resolves at integration). packages/rex/src/migrations/v1-to-v2/apply.ts:291-304: toNode copies ...rest, blockedBy included, onto every node type. fde93c35's repoint at 257-283 covers only dissolved containers, so v1 dependencies between features that became capabilities or constraints, or from changes onto them, are copied verbatim and v2 rejects them.\n\nFailure scenario, on this repository's tree (52 refs involve a product node, 18 with an open end): 'Migrate this repository' (pending change) is blockedBy 'Dashboard on the v2 model' and 'Agent brief from the product layer' (capabilities); selection (core/change-selection.ts:65) waits for status completed, which nothing sets on a capability, so the change is blocked forever. 'Agent brief from the product layer' (capability) is blockedBy two capabilities; selection never reads a product node's blockedBy, so its changes become selectable early. rex health reports these as ref-resolves errors, so rehearsal gate item 2 fails; placing 9f75db42 itself is refused for its capability blockedBy.\n\nDecision S2-Q1 (Ryan, 2026-10-12): an edge from a change or task to a capability or constraint becomes edges to that node's open changes; if none are open, the dependency is met: drop it and report it. A capability's own blockedBy moves onto each of its open changes, rewritten the same way. The dry run lists every rewrite and drop; this folds b77fb78f (the dissolved-container repoint is reported the same way). Keep it minimal (Ryan: low v1 adoption): one rewrite step plus a list, no new plan-file data."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T02:34:35.019Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
