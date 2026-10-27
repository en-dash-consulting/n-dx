---
id: "28f56c4d-9bb7-4058-a56a-ef4829635b95"
type: "change"
title: "Analysis header is one tidy block: status line under the title, a single split Re-analyze control, no emoji or raw checkbox"
slug: "analysis-header-is-one-tidy-block"
intent: "User (2026-10-15): \"this piece is still ugly.. the bottom row especially. and the emojis. and the checkbox. the ux and the ui.\" The Analysis page head is the stage title row plus a second row of branch/sha/age text, \"Pass 1\" and \"Reset from Pass 4 → 1\" badges, a native \"Deep (sub-packages)\" checkbox and two emoji buttons (🔄 Re-analyze, ✨ Full analysis). Redesign: one header block — title and blurb, with a quiet status line under it (branch · sha · analyzed N ago · enrichment meter \"Pass N of 4\", the reset in its tooltip) — and on the right one split button: Re-analyze (SVG icon) plus a menu with Full analysis (described) and an Include sub-packages switch. AnalyzeControls is shared with the Ask panel, which gets the same control."
acceptanceCriteria:
  - "The Analysis page shows its title, blurb, status line and analyze control as one header block, with no separate meta row."
  - "The status line shows branch, commit, analysis age and an enrichment meter (pass N of 4); the reset note is in the meter's tooltip, not a badge."
  - "The analyze control is a split button: Re-analyze, and a menu with Full analysis and an Include sub-packages switch; no emoji, no native checkbox."
  - "Running and finished states still show (spinner in the button, status text), and the Ask panel's use of the control still works."
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "dashboard"
source: "ndx-capture"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "SourceVision section runs the full analysis flow with all tabs and recommendations visible" (a83b1a2f-8315-4ba6-b10b-d70ba4f68479).
