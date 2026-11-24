---
id: "c3e820e6-4b9e-4df6-9c17-3610d4424e61"
type: "task"
title: "Side panel tabs cover the next-stage link and float over the Sidecar drawer"
slug: "side-panel-tabs-cover-the-next-stage"
summary: "On Plan and Work the new side-panel tabs sit on top of the 'Next stage' link at the page's right edge, and over the Sidecar drawer when it is open, so neither can be used. The tabs should live in the page's own right gutter."
description: "Failure: .stage-side (styles/stage-tiles.css) is position: fixed; right: 0; z-index: var(--z-slideout) (400), with tabs from 96px down. Plan has 6 tabs (~750px of column), which crosses the vertical middle where .stage-link-next sits (styles/shell.css:212, position: absolute inside .app-body, z-index 15), so 'Next: Work' is covered and unclickable; Work's one tab can do the same at short heights. With the Sidecar open (styles/sidecar.css:31, a flex child at z-index 16), the tabs float over the drawer. Reachability: every Plan and Work visit at desktop width. Verdict: must-fix (high), introduced by efcc0da8e. Options: (a, recommended, chosen) render the tabs inside .app-body's right gutter (sticky, not fixed, below the Sidecar's z-index) so they move with the drawer, and end the column above the next-stage link's slot; (b) keep them fixed but offset by --sidecar-w and move the stage link below the tab column — more coupling. Related, completed: 3c749a61 (the right stage link never covers content on a body narrowed by the Sidecar)."
acceptanceCriteria:
  - "With six Plan side tabs at a 768px-high viewport, the next-stage link is not overlapped by any tab (stylesheet/layout test)"
  - "With the Sidecar drawer open, no side tab is drawn over the drawer (the tab column is inside .app-body, not position: fixed to the viewport)"
  - "The side panel itself still slides in over the page and closes as before (existing side panel tests pass)"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
