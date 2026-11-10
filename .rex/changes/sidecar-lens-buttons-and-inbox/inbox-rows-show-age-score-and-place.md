---
id: "6917ec09-6f4c-4020-a98f-9b513e36f6dd"
type: "task"
title: "Inbox rows show age, score and Place with Sidecar; the count matches get_prd_status; the empty state explains held changes"
slug: "inbox-rows-show-age-score-and-place"
description: "Story F gaps in the Plan › Inbox section (packages/web/src/viewer/views/inbox.ts). Each row shows the change's age, its top suggestion with a numeric score beside the strength chip, and a 'Place with Sidecar' button (the existing PlaceWithSidecar component, shown while web.sidecar is on) next to Place. Make the Inbox count one rule shared by the web status route (src/server/routes-status.ts awaitsPlacement) and rex's get_prd_status (packages/rex/src/core/product-report.ts): every open change with needsPlacement counts, including on a tree with no live capability yet, and add a parity test. The empty state explains that a change held in the Inbox cannot close and that ndx work skips its tasks until it is placed. Uses E's age field. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; add a patch changeset per package touched."
acceptanceCriteria:
  - "Inbox rows show age, top suggestion with its score, and Place with Sidecar (viewer tests)"
  - "The web Inbox count equals get_prd_status's count on the same tree, including a tree with no live capability (parity test)"
  - "The empty state says held changes cannot close and their tasks are skipped until placed (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
