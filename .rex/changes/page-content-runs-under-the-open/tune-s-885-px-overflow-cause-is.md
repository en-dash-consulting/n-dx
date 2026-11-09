---
id: "8a883929-ec2e-4fd2-bc9d-d9a48fcf0e82"
type: "task"
title: "Tune's workflow suggestion actions wrap so the Dismiss button stays inside its card"
slug: "tune-s-885-px-overflow-cause-is"
description: "Operator browser check (2026-11-06, after tasks 65f61f71..87222b56) named the Tune element: on /tune with #main-content at 584 px (1024 px viewport, 440 px drawer) and at 1000 px (1440 px viewport), each workflow suggestion card (.wf-suggestion-card, about 238 px wide in its stage tile) has a .wf-suggestion-actions row (packages/web/src/viewer/styles/workflow-optimization.css: display: flex, no wrap) whose last button, .cmd-btn.cmd-btn-danger.wf-btn-reject ('Dismiss', 90 px), ends at 651 px against the card's 555 px right edge. The stage tile body (overflow: hidden) clips it, so the Dismiss button cannot be seen or clicked. Fix: let .wf-suggestion-actions wrap (flex-wrap: wrap) so its buttons move to a new line inside the card; keep .link-btn's margin-right: auto behaviour at full width. The other Tune reading, .token-table up to 1400 px, sits inside .token-table-wrapper (overflow-x: auto) and scrolls, so it is not a defect: leave it. The defensive Tune shrink rules run 8b1b2b69 added in stage-tiles.css can stay. Operator notes: you cannot measure layout in this run; the operator re-measures in a real browser afterwards. Style only with tokens from packages/web/src/viewer/styles/tokens.css and keep both themes. Do not touch the Sidecar drawer's open/close logic, .n-dx.json, packages/web/AGENTS.md or src/server/AGENTS.md. Test the rule the way tests/unit/viewer/stage-tile-tree-fill.test.ts does (read the stylesheet and assert the declaration on the selector). Run the touched viewer tests and the static root policy suites before finishing; add a @n-dx/web patch changeset."
acceptanceCriteria:
  - ".wf-suggestion-actions wraps (flex-wrap: wrap) so its buttons stay inside the suggestion card (stylesheet test)"
  - "On /tune with the drawer open at 1024 px and 1440 px, the Dismiss button is inside its card (operator browser check)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
