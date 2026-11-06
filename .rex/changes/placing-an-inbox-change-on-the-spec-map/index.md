---
id: "464a9480-8e07-49cd-9889-21d2ae55f316"
type: "change"
title: "Placing an Inbox change on the spec map"
slug: "placing-an-inbox-change-on-the-spec-map"
intent: "Slice S7 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, revision 12, section 4c; decisions AD8, WF1–WF10). Built on the Sidecar stack.\n\nPlacing a change happens on the area view's spec map, beside a candidate panel of spec cards. The panel is main's \"Where it goes\" component (components/prd-tree/change-placement.ts, #894–#899) in a wider layout wired to the map, not new placement logic: it keeps rex's shortlist, search, Touches or Amends with criteria edits, Place, Place & next, Place & add another and Nothing fits, and writes through the existing /place and /propose routes. The 320px version stays in the change detail panel.\n\nThe workflow (WF1–WF10):\n- Every Place (Inbox tile row, Inbox page, the area view's Inbox card) opens placement mode; the detail panel's compact version keeps a \"Place on the map\" switch.\n- A strong, untied top pick zooms straight into its area; otherwise the map opens at the area level with candidate counts.\n- Candidates in other areas show as chips above the map and as cards in the panel; picking one moves the map and keeps the edits.\n- rex's relation is pre-selected only for a strong, untied pick; otherwise the card asks whether the change alters what the capability promises.\n- An amendment is edited in the card, re-checked on every edit through L2's read-only /placement/check, with the same dry-run line as the Sidecar's placement card; Place waits for the check. The block shows the pending criteria count.\n- Nothing fits draws a dashed ghost block in the zoomed area that takes the proposal's title as you type; blocks sharing its words stay lit.\n- Place & next opens the next Inbox change, strongest first; #896's keys work.\n- With the Sidecar off and rex.placementDraft on, the one-shot draft's pick is a candidate card marked \"model\", never pre-selected.\n- Place & add another keeps the panel on an umbrella change; each home gets a marker.\n- Leaving with an unsaved pick or edit keeps it as a draft on the change for the browser session; nothing reaches the PRD until Place.\n\nThe Sidecar parts of placing (one decision surface while the drawer holds a placement card, Place with Sidecar replacing the model draft) are S8."
acceptanceCriteria:
  - "Place on an Inbox tile row, the Inbox page or the area view's Inbox card opens the area view in placement mode"
  - "A strong untied pick opens zoomed into its area; any other shortlist opens at the area level with candidate counts per area"
  - "The panel lists candidates from every area as spec cards, and picking one in another area moves the map without losing edits"
  - "Amendment edits re-check through /placement/check and Place stays disabled until the check returns"
  - "Nothing fits shows a ghost block that follows the proposal's title"
  - "Place & next, Place & add another and the #896 keyboard shortcuts work in placement mode"
  - "Leaving placement mode keeps an unsaved pick or edit as a draft that Place resumes"
  - "All writes go through the existing /place and /propose routes"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "medium"
tags:
  - "web"
  - "dashboard"
  - "plan-page-redesign"
  - "placement"
source: "ndx-capture"
blockedBy:
  - "9b5e6519-b13e-4ca2-a70a-40988f4dcea8"
---
