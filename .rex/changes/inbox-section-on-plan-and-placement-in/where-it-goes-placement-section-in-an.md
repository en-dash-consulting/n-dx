---
id: "083b030f-c63d-4f00-b27b-04921b763228"
type: "task"
title: "Where it goes: placement section in an Inbox change's detail panel"
slug: "where-it-goes-placement-section-in-an"
description: "New `components/prd-tree/change-placement.ts`, rendered by `components/prd-tree/task-detail.ts` at the top of the panel (after the title) only while the change is in the Inbox. Contents, top to bottom:\n- A note: \"In the Inbox. ndx work skips its tasks until it has a place on the product map.\" with \"N of M · Next ›\".\n- \"Where it goes\": the shortlist from `GET /api/rex/changes/:id/placement` as radio rows (title, strength chip, area and matched words), with a \"tied\" or \"weak matches\" warning when it applies.\n- A search over every capability and constraint, grouped by area, from `GET /api/rex/product` (already served).\n- Touches / Amends. Amends reveals an amendment summary, the target's current criteria with edit and remove, \"+ criterion\", and an optional replacement statement; it uses the same in-place criterion editing the panel already has for Done when.\n- Buttons: Place, Place & next, Place & add another (an extra touches, IB3), and \"Nothing fits\", which swaps in the proposal form: type, under area, title, statement, criteria; Propose and Propose & next.\n- Refusals show inline with rex's message; `kind` picks the hint (nothing-to-modify points at the criteria field). Pending warnings show as a note after a successful place.\nWhen the change leaves the Inbox, the section is replaced by a one-line \"Placed: touches <title>\" in the panel. \"+ Add Task\" on an Inbox change gains the note \"Its tasks won't run until the change is placed.\" Fits the 320px panel (280px under the responsive breakpoint)."
acceptanceCriteria:
  - "An Inbox change's panel shows the note, shortlist with strength and area, search, relation and actions; a placed change's panel does not"
  - "Place writes through POST /place; Propose through POST /propose; both refresh the panel, the tree and the counts"
  - "Place & next opens the next Inbox change in the Inbox section's order"
  - "Amends with neither statement nor criteria is refused inline with rex's message"
  - "A tied or all-weak shortlist shows its warning"
  - "Controls are labelled and keyboard reachable; focus lands on the next change's title after Place & next"
  - "Component tests cover each state and each refusal kind"
priority: "high"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
