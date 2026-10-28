---
id: "255e3d55-fdfc-4f72-b587-2c33bea4e0e5"
type: "change"
title: "Top bar crushes the brand and project name between 1,100px and ~1,300px"
slug: "top-bar-crushes-the-brand-and-project"
intent: "Found by an adversarial review of c261fd09 (Plan page scrolls sideways after a capture Preview). Pre-existing, not introduced there.\n\nScenario: dashboard window 1,101–~1,300px wide. The top bar's product hints and search label show (they drop only at max-width 1,100px since c261fd09). Tabs (~558px), search (min-width 220px), run control (~129px) and guide (~36px) do not shrink. Brand and `.project-context` have min-width 0, so they take what is left: measured in the e2e fixture at 1,024px before the fix, brand 17px and project context 33px. The project name and branch are cut to a few characters. A longer run label or more tabs would push the bar past the window again, the original sideways-scroll bug.\n\nEvidence: packages/web/src/viewer/styles/shell.css (.topnav, .topnav-search min-width 220px, the 1,100px media rule); packages/web/src/viewer/styles/breadcrumb.css:6 (.project-context min-width 0).\n\nReachable: every page, any window in that range.\n\nOptions:\n1. Let `.topnav-tabs` shrink (min-width 0) and drop hints by container query on the bar, not the viewport. Fits any content. Cost: moderate; risk: container-query support (fine in evergreen browsers).\n2. Give brand and project context a floor (e.g. min-width 120px) and drop hints earlier. Cheap, but still a magic width.\nRecommendation: 1.\n\nVerdict: out-of-scope (pre-existing), severity low."
acceptanceCriteria:
  - "At every window width from 1,024px to 1,400px, the dashboard's top bar is no wider than the window"
  - "At every window width from 1,024px to 1,400px, the brand and the project name in the top bar each keep at least 100px"
  - "A browser test measures the top bar at 1,150px and 1,280px with a long project name and fails if either criterion breaks"
touches:
  - "22ba5028-7c95-4ecb-b74b-b5d4816bc0ae"
priority: "low"
discoveredFrom: {"item":"c261fd09-fec0-49c5-92ac-c3b4bfe9fe37","run":"bf512578-cd2d-429a-aab4-1c31702d1daf"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "layout"
source: "ndx-adversarial-review"
---
