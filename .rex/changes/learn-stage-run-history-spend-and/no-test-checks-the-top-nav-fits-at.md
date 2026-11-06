---
id: "95300e23-699c-4649-8aa2-af95a1d4b6a0"
type: "task"
title: "No test checks the top nav fits at 1440, 1200, 1100 and 960 px with Tune and the Sidecar button"
slug: "no-test-checks-the-top-nav-fits-at"
description: "Verdict: should-fix (medium). Found by adversarial review of 03b6cc9a.\n\nThe task's acceptance criterion \"The top nav does not overflow at 1440, 1200, 1100 or 960 px with the Sidecar button present\" is satisfied by assertion only. The change added a tier at max-width 1099px in packages/web/src/viewer/styles/sidecar.css (tighter .topnav-tab padding), but nothing measured the bar in a browser. .topnav-tabs is overflow-x:auto and flex 0 1 auto, so the page itself cannot overflow, but the tabs can silently scroll so Tune or Live is clipped at 1100-1199 px with a long project name, which the criterion means to rule out.\n\nOptions: a Playwright spec in tests/e2e-ui (sidecar on, viewport at each width) asserting .topnav scrollWidth <= clientWidth and .topnav-tabs scrollWidth <= clientWidth, and that .topnav-sidecar is the last visible child within the viewport. Recommended; cost one spec. If it fails, add the next width step (hide .topnav-tab-glyph or the Live label) rather than raising the width."
acceptanceCriteria:
  - "A Playwright spec sets viewports 1440, 1200, 1100 and 960 with web.sidecar on and asserts neither .topnav nor .topnav-tabs scrolls horizontally"
  - "The same spec asserts the Sidecar button is the last control and lies inside the viewport at each width"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
