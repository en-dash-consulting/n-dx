---
id: "379faca3-3f85-4e56-92e2-f6d9fd8be796"
type: "task"
title: "Sidecar attaches the current page and picks a lens the operator can switch"
slug: "sidecar-attaches-the-current-page-and"
description: "Story 09, UI only over the PATCH route and session target. Inbox and Migrate mappings wait for those pages (R3, G1); in-page Ask and Explain buttons (UX3) move to M3 stories 16 and 17. Mock: Drawer states B board. CAOS story: https://www.notion.so/3f7a80b7192481fea2d1d0effbc05cec."
acceptanceCriteria:
  - "The page sets the default lens from the M1 lens registry, not a hard-coded list: a task gives Describe, or Diagnose run when its last run failed; a capability or zone gives Explain; Plan gives Plan; Live gives Guide (tested)"
  - "A lens M1 registers as unavailable shows on the chip as \"not available yet\" and the session runs General (tested)"
  - "The chip, or / in an empty composer, switches the lens through PATCH /api/sidecar/sessions/:id (tested)"
  - "The attachment chip shows the current page item as the session target and can be removed (tested)"
priority: "medium"
source: "caos"
---
