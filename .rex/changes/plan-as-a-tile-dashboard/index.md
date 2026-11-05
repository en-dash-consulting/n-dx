---
id: "9e95f7f4-a9ba-4a9a-a66b-300a0d2f7509"
type: "change"
title: "Plan as a tile dashboard"
slug: "plan-as-a-tile-dashboard"
intent: "Slice S2 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, revision 12; decisions PP1, PP6, PP14, PP15, SP1, SP5). Built on the Sidecar stack.\n\nPlan stops being a stack of collapsible sections. After the capture bar it renders tiles through StageDef.tiles, as Analysis does: Product map first, full width (12×2, PP15), then Inbox (4×2), Open changes (8×2, the Changes view, with the PRD tree as a Tree tab through StageTile.tabs) and Validation (6×1). This slice shows the existing views as tile previews; the purpose-built glance panels come in S3 and S4. Each tile opens full-screen in place, with the detail panel beside it, and through Open ↗ to its own page.\n\nThe Inbox section's live badge (badge: \"inbox\", added by #894) moves to tiles: StageTile gains the same badge. openWhenNonEmpty has no tile meaning; at zero the Inbox tile reads \"Inbox is empty\" and keeps its place.\n\nSidecar (stack #902/#906): the Plan stage page must keep attaching to the drawer as the `plan` page item so the Plan lens stays its default, and the Sidecar's ghost rows (UX5) must keep showing in the tree now that it lives in the Tree tab."
acceptanceCriteria:
  - "Plan renders the capture bar and then a tile grid with the Product map first at full width, then Inbox, Open changes and Validation tiles; no collapsible sections remain on Plan"
  - "The Inbox tile shows the open Inbox count in its header and stays on the page at zero"
  - "Open changes opened full-screen has List and Tree tabs, and selecting an item in the tree opens the detail panel beside it"
  - "/prd, /changes, /product, /inbox and /validation keep their routes; restored-views and the stage-page snapshot tests pass"
  - "On a v1 project, where Inbox, Product and Changes do not apply, Plan shows a Tasks tile in their place"
  - "With web.sidecar on, the Plan page still attaches as the plan item (Plan lens) and a waiting change-set card's ghost rows show in the Tree tab"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
  - "797fa0aa-caa0-433f-aa50-de87f0c05e90"
priority: "high"
tags:
  - "web"
  - "dashboard"
  - "plan-page-redesign"
source: "ndx-capture"
blockedBy:
  - "f5c7b061-22b2-4b84-93cd-55793d328d68"
---
