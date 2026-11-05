---
id: "c1540b54-73c8-4a6d-b6b7-d9f71426c8cf"
type: "task"
title: "With the Sidecar on, the top-nav tabs scroll and clip Tune or Live at 1440, 1200, 1100 and 960 px"
slug: "with-the-sidecar-on-the-top-nav-tabs"
description: "Verdict: must-fix (high), not fixable inside the review pass because it needs a design decision on the UX2' tiers. Found by the adversarial review of 95300e23, whose new spec packages/web/tests/e2e-ui/topnav-width.spec.ts is red at every width.\n\nMeasured in Chromium on the fixture project (short name `ndx-e2e-ui-XXXXXX`, Work page, `features.web.sidecar` on, after the branch chip and run control load):\n\n| width | tabs content | tabs space | short |\n|---|---|---|---|\n| 1440 | 692 | ~535 | ~157 px (hints shown: Analysis tab alone 204 px) |\n| 1200 | 470 | 458 | 12 px |\n| 1100 | 470 | 363 | 107 px (the 1099 tier does not apply at 1100) |\n| 960 | 420 | 375 | 45 px |\n\nFixed-width neighbours at 1440: brand 100, project-context 213 (flex 0 0 auto, min 140), guide 36, run control 129, search 220 (min 220), divider, Sidecar 82, plus 12 px gaps and 32 px padding. `.topnav-tabs` is `flex: 0 1 auto; overflow-x: auto` with a hidden scrollbar, so the page never overflows but Tune or Live silently scroll out of view. A long project name makes every tier worse. Reachable: any user with web.sidecar on, at common laptop widths. CSS lives in packages/web/src/viewer/styles/sidecar.css (tiers) and shell.css (.topnav, .topnav-tab, .topnav-search).\n\nAlso note: the spec only passes reliably if it waits for the branch chip and run control; before they load the bar measures narrower and several widths pass falsely.\n\nOptions:\n1. Let project-context shrink (flex 0 1 auto, min-width ~100, ellipsis on the name) and drop the run control to its icon below 1440. Cheap, fixes 1200/1100 and the long-name case; 1440 still needs hints off or search narrowed. Recommended combined with 2.\n2. Re-cut the tiers: stage hints show only at ≥1600 (or when the Sidecar is off); search label drops below 1440; tab padding tightens below 1200 instead of 1099; at 960 hide .topnav-tab-glyph. Decision for the design owner: what UX2' \"everything shows at 1440\" gives up.\n3. Move the run control into the bottom bar. Larger UX change; decide in the Plan page design doc.\n\nVerify with `pnpm --filter @n-dx/web build` then `pnpm --filter @n-dx/web exec playwright test tests/e2e-ui/topnav-width.spec.ts --repeat-each=3`."
acceptanceCriteria:
  - "packages/web/tests/e2e-ui/topnav-width.spec.ts passes at 1440, 1200, 1100 and 960 px with --repeat-each=3"
  - "With a 40-character project name, .topnav-tabs does not scroll horizontally at 1100 px (covered by a spec case)"
  - "The UX2' tier comments in top-nav.ts and sidecar.css describe the tiers as built"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
