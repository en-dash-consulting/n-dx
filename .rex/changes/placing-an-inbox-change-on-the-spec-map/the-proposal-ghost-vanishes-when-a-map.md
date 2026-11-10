---
id: "bf1aba58-c329-479f-beb1-42f4d8b5f625"
type: "task"
title: "The proposal ghost vanishes when a map pick moves away from its area, and re-picking that area does not bring it back"
slug: "the-proposal-ghost-vanishes-when-a-map"
description: "Verdict: should-fix (ndx-adversarial-review of cc097ef0, severity low).\n\nScenario: in placement mode, open Nothing fits with the form under area A (ghost drawn in A). Click a candidate chip above the map, or a block in A that sits in another area via a chip, or go to Product map and zoom into area B. `choose()`/`setZoom` move the map to B; the ghost is drawn only when `ghostArea?.slug === zoom` (packages/web/src/viewer/views/placement-mode.ts, ZoomedArea call), so it disappears while the form still says A. Choosing A again in the form's select changes nothing: the zoom effect is keyed on `ghostArea?.slug`, which did not change. The only way back is to pick another area and then A, or to zoom into A from the area level.\n\nReachable: yes, the chips and blocks stay clickable while the proposal form is open.\n\nOptions:\n1. While the form is open, a map pick of an area (zooming into an area block) sets the form's area to it, so the map and the form name one area (form needs a controlled `under` or a \"follow\" callback). Recommended: it matches WF6, where the ghost and the area move together.\n2. Re-run the zoom effect on every form `under` report (key it on a counter or the ghost object), so re-picking A in the select moves the map back. Cheaper; leaves the map and form disagreeing until then."
acceptanceCriteria:
  - "With the proposal form open under area A, zooming the map into area B (area-level block) moves the form's area to B and draws the ghost in B"
  - "With the proposal form open, choosing in the form the area the ghost was last drawn in brings the map back to it and redraws the ghost"
  - "placement-mode.test.ts covers both cases"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
