---
id: "0727d008-d1d0-427f-b780-cd0c410a7594"
type: "change"
title: "Add & place in the capture Preview, and the full Inbox page"
slug: "add-place-in-the-capture-preview-and"
intent: "PR 4 of 5 for issue #873. Design and decisions: https://claude.ai/artifact/PS6Jg1NgsJ2a6nidJx4HBm.\n\nTwo pieces on top of PR 3:\n1. Capture-time placement. The v2 capture Preview (`components/prd-tree/smart-add-input.ts`, `ChangePreviewCard`) already shows the rules' shortlist as \"Suggested placement\", read-only: five rows, each with a \"touches\" badge and no strength, area or reasons. It then says \"Next: place it on the capability it changes…\" above a full-width \"Add 1 change\" button. Make the shortlist a choice so most new changes never enter the Inbox. IB8: pre-select the top pick only when it is strong and untied, otherwise default to \"Leave it in the Inbox\". This matters on real data: for the windowsHide change, the runner-up also scores strong (11) and is the wrong home.\n2. The Inbox section's own page (\"Open ↗\") for clearing a backlog: list on the left, the detail panel's Where it goes section inline on the right, Place & next, keyboard shortcuts."
acceptanceCriteria:
  - "The capture Preview lets the user pick a candidate (with strength and area), Leave it in the Inbox, or Amends…; Add & place creates a placed change"
  - "The pre-selection follows IB8: top pick only when strong and untied"
  - "Open ↗ on the Inbox section opens a full page where a change can be placed and the next one selected from the keyboard"
  - "Changeset bumps @n-dx/web as patch"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
tags:
  - "inbox-placement"
  - "issue-873"
  - "web"
source: "ndx-capture"
blockedBy:
  - "21a8d036-41d6-45fb-b10c-181f074f3e4f"
---
