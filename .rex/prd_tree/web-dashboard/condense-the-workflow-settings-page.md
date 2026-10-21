---
id: "c062538b-e50d-4eef-a870-daa1990a05b3"
level: "feature"
title: "Condense the Workflow settings page into a responsive grid of fields"
status: "pending"
priority: "medium"
source: "ndx-capture"
acceptanceCriteria:
  - "Fields in each Workflow section render in a multi-column grid on desktop widths and collapse to one column at phone width, with no horizontal scroll"
  - "The full Workflow page needs noticeably less vertical scrolling than the current single-column layout at a 1440x900 viewport"
  - "Each field still shows its label, modified/unsaved badges, reset action, config path and description; long descriptions are truncated or collapsible rather than stretching the card"
  - "Wide controls (tag lists, multi-line inputs) can span the full grid width instead of being squeezed into one column"
  - "Layout uses existing design tokens and works in both light and dark themes"
  - "No change to save, reset or leave-guard behaviour; the full web suite passes"
description: "The Workflow settings page (Work settings, PRD settings, CLI timeouts, Templates) gives every field its own full-width row, with the name, path, description and control stacked. A basic change means scrolling a long way past fields you aren't touching. Lay the fields out in a responsive grid of compact cards so more settings fit on screen at once. Keep each field's modified/unsaved badges, reset action and description. Behaviour stays the same: the single shared SettingsFrame, each section saving to its own endpoint, and the dirty-state guard."
lastModified: "2026-10-20T17:59:46.374Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
