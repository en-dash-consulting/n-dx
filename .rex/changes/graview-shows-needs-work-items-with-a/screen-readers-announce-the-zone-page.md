---
id: "ab3a15ec-6d20-4c2c-abda-e2e561bb2240"
type: "task"
title: "Screen readers announce the zone page's needs-work badge twice"
slug: "screen-readers-announce-the-zone-page"
summary: "On the product map's zone page, screen readers read the warning badge's text twice. This removes the duplicate."
description: "Verdict: should-fix (severity low, trivial), from the adversarial review of feat/graview-needs-work-markers.\n\nIn packages/graview-face/src/ui/screens/zone.tsx:35-45, <Mark> (role=img, aria-label 'Needs work: X') sits inside a Badge whose visible text is 'needs work: X', announced as 'Needs work: X needs work: X'; the highlighted badge does the same.\n\nFix: give Mark a decorative prop that renders aria-hidden with no label, and use it inside badges."
acceptanceCriteria:
  - "Inside a badge, the Mark is aria-hidden and has no accessible name"
  - "Outside a badge (rows and cards), the Mark keeps its aria-label"
  - "A test asserts the zone page badge's accessible name contains the needs-work text once"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
