---
id: "5046a851-a540-4c7d-9d23-ca2651a8ac57"
level: "task"
title: "Escape does not close the Live tab peek when it was opened by hover"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With the peek opened by hover and focus elsewhere, Escape closes it (unit test)."
  - "A peek opened by focus stays open when the pointer leaves, until focus leaves or Escape."
description: "Failure: `packages/web/src/viewer/components/live-tab.ts:201` handles Escape in `onKeyDown` on the wrapper, so it arrives only when focus is inside. Hover the tab with focus elsewhere and press Escape: the peek stays open, which fails WCAG 2.1 SC 1.4.13 (hover content must be dismissible without moving the pointer). Also, a peek opened by keyboard focus closes when the mouse leaves while focus stays on the tab.\n\nReachability: any hover over the Live tab. Verdict: should-fix (severity low).\n\nOptions:\n- Recommended: add a document keydown listener only while the peek is open, and keep it open while either hover or focus holds it. Small."
lastModified: "2026-10-01T15:22:59.614Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
