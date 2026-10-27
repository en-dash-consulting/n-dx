---
id: "01d36c78-747d-470e-a478-7de18baa408c"
type: "change"
title: "Dynamic Content ARIA, Icon Labeling, and A11y Regression Coverage"
slug: "dynamic-content-aria-icon-labeling-and"
intent: "The dashboard uses SSE/polling to push real-time updates to the UI (hench run progress, PRD status changes, token usage). These dynamic updates are invisible to screen readers without explicit ARIA live regions. This feature adds live region infrastructure for polling-driven updates, labels all icon-only interactive elements across the dashboard, and establishes automated a11y regression tests to prevent regressions as the UI evolves."
touches:
  - "0842c3e1-f5fc-4cb7-b3e2-be50161d1633"
source: "smart-add"
---
