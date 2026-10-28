---
id: "91443fd6-379c-495b-bb76-1c22faf54cfc"
type: "task"
title: "Changes view: Open / Applied / release filters, and render only expanded groups"
slug: "changes-view-open-applied-release"
description: "Add filter chips to the Changes view: Open (default), Applied, and one per release with its count. Remember the choice per viewer in localStorage (wrapped in try/catch). Render the rows of a collapsed group lazily, so 1,241 applied Unscheduled changes cost nothing until expanded. Measure the view's first render on this repo's PRD before and after and note both in the PR."
acceptanceCriteria:
  - "Open is the default filter and the first screen shows open changes"
  - "Applied and per-release filters work and show counts"
  - "Collapsed groups mount no rows"
  - "Tests cover the filters and lazy rendering"
priority: "medium"
tags:
  - "web"
  - "changes-view"
source: "ndx-capture"
---
