---
id: "8a883929-ec2e-4fd2-bc9d-d9a48fcf0e82"
type: "task"
title: "Tune's 885 px overflow cause is unidentified; the shrink rules added for it are unverified"
slug: "tune-s-885-px-overflow-cause-is"
description: "Verdict: should-fix (ndx-adversarial-review of task 65f61f71). Run 8b1b2b69 could not measure layout, so it applied defensive shrink rules to the Tune panels (packages/web/src/viewer/styles/stage-tiles.css: .outcomes-panel/.tooling-panel/.delivery-panel min-width: 0; .outcomes-rows and .delivery-dimensions minmax(0, 1fr); .tooling-vendors minmax(min(9rem, 100%), 1fr)). Every Tune tile body already has overflow: hidden and min-width: 0, and the tile grid uses minmax(0, 1fr) tracks with #main-content (.main) at min-width: 0, so no element was proven to cause the 885 px reading. Clipped tile content still reports bounding rects past the column, so a getBoundingClientRect measurement may count invisible content. Scenario: 1024 px viewport, 440 px Sidecar drawer (main 584 px) on /tune: measure #main-content.scrollWidth and the rightmost visible element. Options: (a) measure in a browser and fix the element that really overflows (recommended; cheap once measured); (b) if scrollWidth is already 584, record that the 885 px figure came from clipped content and close. Risk: none beyond the CSS rule."
acceptanceCriteria:
  - "At a 584 px #main-content on /tune, #main-content.scrollWidth equals its clientWidth (measured in a real browser and recorded)"
  - "The element that reached 885 px is named, and a stylesheet test asserts the declaration that makes it shrink, or the item records that the reading came from clipped tile content"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
