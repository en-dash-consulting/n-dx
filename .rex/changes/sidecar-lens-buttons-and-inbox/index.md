---
id: "469f3744-d709-42b0-a2b1-7b382870dd14"
type: "change"
title: "Sidecar lens buttons and Inbox placement details the audit found missing"
slug: "sidecar-lens-buttons-and-inbox"
intent: "An audit of the Sidecar epic's CAOS stories against the code (2026-11-05) found three stories partly built. D (Sidecar attaches the current page and picks a lens, 3f7a80b7-1924-81fe-a2d1-d0effbc05cec): no in-page Ask or Explain buttons on task, capability or zone pages, and the Inbox page does not default the drawer to the Place lens. E (Rex lists Inbox changes awaiting placement with their shortlists, 3f7a80b7-1924-81d2-b9da-e4d27953f7a1): GET /api/rex/changes/placements exists, but there is no CLI read and no age field. F (Plan tab shows an Inbox of changes awaiting placement, 3f7a80b7-1924-81e7-940f-f74b8d2c8445): rows lack age, numeric score and 'Place with Sidecar', the web count rule (routes-status.ts awaitsPlacement) differs from get_prd_status (rex product-report.ts isOpenChange && needsPlacement), and the empty state does not explain that held changes cannot close. D's Migrate-page criterion belongs to the migration assistant feature and is out of scope here."
acceptanceCriteria:
  - "Stories D, E and F of the Sidecar epic meet every acceptance criterion except D's Migrate page (tests)"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "797fa0aa-caa0-433f-aa50-de87f0c05e90"
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
source: "ndx-capture"
---
