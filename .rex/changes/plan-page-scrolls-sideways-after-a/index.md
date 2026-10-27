---
id: "c261fd09-fec0-49c5-92ac-c3b4bfe9fe37"
type: "change"
title: "Plan page scrolls sideways after a capture Preview"
slug: "plan-page-scrolls-sideways-after-a"
intent: "Found 2026-10-27 while checking the dashboard for issue #873. On a v2 project, in a 1,024px-wide window (the Claude desktop browser pane), type a change into Plan's capture bar (\"Describe a change for the Inbox…\") and press Preview. The document becomes 1,104px wide against a 1,024px viewport, and the page scrolls 80px sideways so its left edge is cut off (the Plan heading and capture bar lose their first characters). The cause was not pinned down: suspects are the preview card in `components/prd-tree/smart-add-input.ts` (`ChangePreviewCard`, its long title row and \"Inbox\" tag, the full-width \"Add 1 change\" button) or a fixed-width element in its styles. Find the element wider than its container, fix it with `min-width: 0`/wrapping rather than hiding overflow, and add a regression test. Touches the same component as the Add & place PR (0727d008); keep the fix small."
acceptanceCriteria:
  - "After a Preview at 1,024px and at 768px wide, the Plan page has no horizontal scroll and nothing is clipped"
  - "Long change titles in the preview card wrap"
  - "A test asserts the preview card fits its container"
  - "Changeset bumps @n-dx/web as patch"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
tags:
  - "web"
  - "bug"
  - "layout"
source: "ndx-capture"
---
