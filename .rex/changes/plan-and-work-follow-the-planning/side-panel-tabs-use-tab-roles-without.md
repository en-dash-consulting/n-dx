---
id: "ec7206ef-341b-4301-80da-438e1f5d7250"
type: "task"
title: "Side panel tabs use tab roles without the tab keyboard model, and the panel is non-modal behind a blocking scrim"
slug: "side-panel-tabs-use-tab-roles-without"
summary: "Keyboard and screen-reader users get tab semantics on the side-panel buttons that do not behave like tabs, and can tab focus behind the dimmed page while a panel is open."
description: "Failure: views/stage-side-panels.ts renders role=tablist/role=tab with no arrow-key handling, the panel is role=dialog (not a tabpanel) without aria-modal, and the scrim blocks pointer use of the page while Tab can still move focus behind it. Scrim-click closing has no test. Reachability: any keyboard or screen-reader use of Plan/Work side panels. Verdict: should-fix (medium), introduced by efcc0da8e. Options: (a, recommended) a disclosure pattern — plain buttons with aria-expanded/aria-controls, and the panel an aria-modal dialog that keeps focus inside until closed; (b) keep the tablist, add arrow keys and a real tabpanel without a scrim."
acceptanceCriteria:
  - "The side tabs follow one ARIA pattern consistently (disclosure buttons, or tabs with arrow-key navigation) — unit test"
  - "While a side panel is open, Tab does not move focus behind the scrim, or the scrim is removed"
  - "Clicking the scrim closes the panel and returns focus to its opener (unit test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
