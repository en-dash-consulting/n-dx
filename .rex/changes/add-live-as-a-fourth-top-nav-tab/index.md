---
id: "dfb31a58-442b-4ee2-bbff-d2b0b0e58419"
type: "change"
title: "Add Live as a fourth top-nav tab outside the stage loop, with a status dot, count and hover peek"
slug: "add-live-as-a-fourth-top-nav-tab"
intent: "Register view ids `live`, `live-task` and `live-analyze` in `packages/web/src/shared/view-id.ts` and the scope lists in `shared/view-routing.ts` (cross-cutting, like `home`), with label, glyph and product in `viewer/views/view-meta.ts`. Live is not a stage: keep `STAGE_ORDER`, `isStageId` and the prev/next stage links unchanged, and render the Live tab in `viewer/components/top-nav.ts` after a divider. `StageProduct` has no cross-product value, so give Live its own meta entry rather than borrowing hench's. Tab states, from the live endpoint: idle (hollow dot, no count), running (pulsing teal dot and the number of live runs and jobs), needs attention (orange dot plus an \"N stuck\" badge when a run has no heartbeat for 5 minutes). Hover or keyboard focus opens a peek listing each live item (title, branch, elapsed, current step; a progress bar for analyze) linking to its page, plus \"Open Live\". Below 960 px the product hints drop as they do today; Live keeps its dot and count. The tab is active on every Live route. Respect reduced motion for the pulse."
acceptanceCriteria:
  - "The Live tab renders on every page after the three stage tabs, separated by a divider, and the stage prev/next links never point to Live."
  - "Idle, running and needs-attention states match the live endpoint and change without a reload."
  - "The hover peek opens on hover and on keyboard focus, closes on Escape, and each row navigates to that item's page."
  - "Screen readers announce the tab as 'Live, 3 running, 1 stuck' (or 'Live, nothing running')."
  - "navigation.spec.ts and the view-id scope tests list the three new views; restored-views and boundary-check tests pass."
amends: [{"target":"ba50eaa7-5f31-4a8d-9e16-6c452882022e","delta":"modified","summary":"Add Live as a fourth top-nav tab outside the stage loop, with a status dot, count and hover peek","base":"47ca7191923435e9fb69c02bec975969b6bd32b464697a3abcf08bc2db752efc"}]
priority: "high"
tags:
  - "live"
  - "web-viewer"
  - "navigation"
blockedBy:
  - "ee6d1469-e731-4c4e-868b-ba2684c11c46"
---
