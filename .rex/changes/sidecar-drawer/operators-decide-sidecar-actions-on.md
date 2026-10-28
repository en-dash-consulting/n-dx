---
id: "2b5fbdf4-9d8b-4f72-85d1-d5471ad4e5ad"
type: "task"
title: "Operators decide Sidecar actions on ordered permission cards"
slug: "operators-decide-sidecar-actions-on"
description: "Story 08 (UX4, UX8). Generic bodies for every card kind; rich change-set and edit bodies stay with M3 story 11 and later. Mock: Cards board. CAOS story: https://www.notion.so/3f7a80b7192481d0bad3fee78325cc7c."
acceptanceCriteria:
  - "Waiting cards draw oldest first, only the first can be decided, and an orange bar above the composer says the agent is paused (tested)"
  - "Cmd+Enter approves and Cmd+Backspace denies the first waiting card, and neither key acts while focus is in a text field (tested)"
  - "Deny sends its optional note as the decision reason (tested on the POST body)"
  - "A command card shows the effects line from GET /api/commands/manifest for its ndx command, or \"no declared effects\" when the manifest has no entry (tested)"
  - "\"Always allow\" is offered only when the card allowListKey is set (tested)"
  - "Every SidecarCardKind draws with a title and its input in the pending, approved, denied, allow-listed and withdrawn states (tested)"
  - "A card withdrawn because the session ended draws as denied with the note \"session ended\", and a route test covers POST /api/sidecar/sessions/:id/end withdrawing waiting cards (tested)"
priority: "high"
source: "caos"
---
