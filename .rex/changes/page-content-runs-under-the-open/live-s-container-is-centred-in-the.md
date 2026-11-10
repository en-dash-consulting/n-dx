---
id: "87222b56-9808-45fb-8bdb-1eec4465438c"
type: "task"
title: "Live's container is centred in the free width, so no one-sided gutter shows on wide windows"
slug: "live-s-container-is-centred-in-the"
description: "Ryan reports a right-side gutter on the Live page that stays after the Sidecar drawer closes. Cause (read on main): packages/web/src/viewer/styles/live.css sets `.live-container { max-width: 1200px; min-width: 0; }` with no centring. When the closed drawer gives the column back and #main-content grows past 1200 px (1440 px and wider viewports), Live's content stays left-aligned and the leftover space sits on the right like a gutter. Home centres its column (`.home { max-width: 1120px; margin: 0 auto; }` in styles/shell.css). At 1024 px the column never reaches 1200 px, so the bug only shows on wide windows. Fix: centre .live-container with margin-inline: auto, keeping the 1200 px cap unless you find a reason not to (say so in the commit if you change it). Check Live's other top-level wrappers (idle state, /live/analyze) use the same container or the same centring. This is a layout fix only: do not touch the drawer's open/close logic, --sidecar-w or the status dock. Operator notes: you cannot measure layout in this run; the operator re-measures in a real browser afterwards. Style only with tokens from styles/tokens.css and keep both themes. Do not edit .n-dx.json, packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar. Test the rule the way tests/unit/viewer/stage-tile-tree-fill.test.ts does (read the stylesheet and assert the declaration on the selector). Run the touched viewer tests and the static root policy suites before finishing; add a @n-dx/web patch changeset."
acceptanceCriteria:
  - ".live-container is centred with margin-inline: auto (or margin: 0 auto) and keeps its max-width cap (stylesheet test)"
  - "With the drawer closed at 1440 px and 1600 px viewport width, Live's left and right gaps inside #main-content are equal within 2 px (operator browser check)"
  - "Opening then closing the drawer on Live leaves no one-sided gap (operator browser check)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
