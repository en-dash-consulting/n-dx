---
id: "1a54e882-1fb1-4c72-b63b-0eee7f6cfb94"
type: "task"
title: "A narrowed wide drawer reports its shown width as aria-valuemax and End cannot restore the full wide width"
slug: "a-narrowed-wide-drawer-reports-its"
description: "Found by adversarial review of task 2e5ceff9 (verdict should-fix, severity low). packages/web/src/viewer/components/sidecar-drawer.ts: the resize separator sets aria-valuemax to Math.max(SIDECAR_WIDTH_MAX, shownWidth), and End calls resizeTo(Math.max(SIDECAR_WIDTH_MAX, shownWidth)). A wide drawer can now be narrowed while staying wide (wideWidth). Scenario: viewport 1440, wide mode, Arrow-Right twice → shown 920; aria-valuemax reads 920 although Arrow-Left can widen to 960, and End stays at 920 instead of going to the full wide width. Reachable from the keyboard and by assistive tech. Fix options: (recommended) use fullWidth (effectiveSidecarWidth) instead of shownWidth for both aria-valuemax and End's target while wide; cost is two expressions and one test. Alternative: drop wideWidth when End is pressed (same effect for End, leaves aria wrong)."
acceptanceCriteria:
  - "With a wide drawer narrowed below its full width, the resize edge's aria-valuemax equals the full wide width (viewer test)"
  - "End on a narrowed wide drawer restores the full wide width (viewer test)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
