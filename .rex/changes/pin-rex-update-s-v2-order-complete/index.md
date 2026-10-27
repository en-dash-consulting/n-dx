---
id: "38978e4a-4c61-4546-989d-fed5e9514725"
type: "change"
title: "Pin rex update's v2 order: complete first, write the other fields only if the completion succeeded"
slug: "pin-rex-update-s-v2-order-complete"
intent: "Review 2026-10-12, PR #690 should-fix 3, which the review marked PLAUSIBLE. Re-verified 2026-10-12 and NOT reproduced; decision (Ryan, 2026-10-12): a test-only task that pins the current order, which the dashboard PATCH (D1-2, PR 36) adopts as the shared rule.\n\nThe finding: packages/rex/src/cli/commands/update.ts:243-249 writes a v2 completion (completeV2Work, one lock hold) and then the remaining fields (--priority, --title, --description, --blockedBy, --criterion, --run) in a second store.updateItem transaction; if the second write were refused, the task would already be completed.\n\nRe-verification on a copy of packages/rex/tests/fixtures/v2-tree with the built CLI at 1ea7984bfb:\n- Every field the CLI can refuse is checked before the completion is written: --blockedBy with a self-reference/cycle or an unknown id (\"Invalid dependencies: …\") and an invalid --run (\"Invalid --run: …\") fail with the task still pending.\n- A refused completion writes no fields: `rex update CH-1 --status=completed --title=Renamed` fails with \"Cannot complete change CH-1: task … is not completed\" and the change's title stays \"Add Apple Pay\".\n- No input was found that is refused by the second write after the completion succeeded.\nSo the CLI already completes first and writes the other fields only when the completion succeeded. The review's suggested alternative (fields first) is the order that causes D1-2's confirmed half-apply in the dashboard.\n\nTask: no behaviour change. Add tests to update-v2.test.ts (or beside it) that pin the order: (1) a refused completion with other fields writes none of them; (2) a refused field (cycle in --blockedBy, invalid --run) leaves the task uncompleted; (3) the success path still writes both. Add a short comment at update.ts:243 stating the rule: complete first, write the other fields only if the completion succeeded, so a refused completion writes nothing."
acceptanceCriteria:
  - "A test: on a v2 copy, rex update <change> --status=completed --title=X with the completion refused fails and leaves the title unchanged on disk"
  - "A test: --status=completed with a refused field (cycle in --blockedBy, invalid --run) leaves the task uncompleted"
  - "A test: the success path writes the completion and the other fields"
  - "A comment at update.ts states the order rule; no behaviour change, existing tests pass unedited"
touches:
  - "b86f9199-bd84-45e8-95a8-bad39e42ebeb"
priority: "medium"
tags:
  - "pr-34"
  - "review-2026-10-12"
  - "lane-rex-domain"
source: "review-2026-10-12"
---
