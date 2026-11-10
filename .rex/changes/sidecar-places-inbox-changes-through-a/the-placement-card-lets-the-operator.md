---
id: "0e769946-9b91-4d17-9376-c691ba7f41ea"
type: "task"
title: "The placement card lets the operator review and edit a Sidecar placement before it is written"
slug: "the-placement-card-lets-the-operator"
description: "The placement card and how the Place lens opens (story 29, viewer half). Design §5 Place (Q8) placement card; mock board Place and Cards."
acceptanceCriteria:
  - "The Inbox triage page and a change awaiting placement offer 'Place with Sidecar', which attaches the change as a 'change' item (ref = change id) and opens the drawer on Place; nothing shows while web.sidecar is off"
  - "The placement card shows the shortlist as radio rows with score, strength and reasons, plus a 'Propose a new capability or constraint' row with type, area and title, a touches/amends toggle, and for amends an editor for the statement and the criteria add, replace and remove; its title line reads '<change> → <target>' or '<change> → new <type> under <area>'"
  - "The card shows the server's dry-run line. An operator edit re-checks through POST /api/rex/changes/:id/placement/check, and Place stays disabled until the line for the edited placement is back (tested)"
  - "Place sends the operator's edits with the approval, and what is written is the edited placement (tested). Leave in Inbox and Deny write nothing (tested)"
source: "ndx-capture"
---
