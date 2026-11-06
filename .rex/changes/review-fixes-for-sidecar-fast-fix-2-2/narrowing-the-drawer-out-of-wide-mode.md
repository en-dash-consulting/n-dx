---
id: "2e5ceff9-f00b-412d-a42b-b6a31326a9c4"
type: "task"
title: "Narrowing the drawer out of wide mode follows the pointer instead of snapping to 640 px"
slug: "narrowing-the-drawer-out-of-wide-mode"
description: "PR review comment on #990 (packages/web/src/viewer/components/sidecar-drawer.ts:400): in wide mode shownWidth is about 1000 px at 1440 px; dragging the edge inward a few pixels calls applyWidth(995), clampSidecarWidth caps it at 640 and the drawer jumps about 360 px and leaves wide mode; Arrow-Right does the same in one 20 px step. Make the edge follow the pointer: while narrowing from wide mode, leave wide mode only once the width is back inside the normal range, and until then apply the dragged width (or ignore the drag until the pointer returns to 360–640 px); the keyboard step moves 20 px from the shown width. Keep the earlier fix that widening from the edge never shrinks a wide drawer. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "Dragging inward from wide mode moves the edge with the pointer without a jump (viewer test)"
  - "Arrow-Right in wide mode narrows by one step from the shown width (viewer test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
