---
id: "3dcb81db-6444-4129-9c97-8a62ad747581"
type: "task"
title: "Tracker chip and Create in tracker have no styles, and the card form opens inside the glance row"
slug: "tracker-chip-and-create-in-tracker"
description: "Verdict should-fix (low). The new classes .tracker-chip, .tracker-chip-state, .change-tracker-chip and .create-in-tracker (packages/web/src/viewer/components/tracker-chip.ts) have no CSS, and CreateInTrackerButton draws the whole TrackerCardForm inside the Open changes row's li.cg-row (views/changes-glance.ts), so on Plan the form squeezes into the row's layout. Reachable with web.sidecar on and a trackerSync connection. Options: style the chip like the existing cg-chip and render the form beneath the row (full width); or open the form in a popover. Recommend the full-width block beneath the row, reusing cg-chip and live-tracker-form classes."
acceptanceCriteria:
  - "The tracker chip on an Open changes row reads as a chip beside the stage chip"
  - "Create in tracker's form opens full width beneath its row, not inside the row's columns"
  - "The e2e-ui happy-click Plan spec covers the Create in tracker control or lists it in the click policy"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
