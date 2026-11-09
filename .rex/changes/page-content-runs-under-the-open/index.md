---
id: "a4e86fcf-f11a-46cf-ac1c-27102bae5722"
type: "change"
title: "Page content runs under the open Sidecar drawer, and the right stage link covers it"
slug: "page-content-runs-under-the-open"
intent: "With the Sidecar drawer open the page body narrows (.app-dock > .app-body takes what the drawer leaves), but some page content does not shrink with it and is drawn past #main-content's right edge, under the drawer, and the right stage link covers content. Measured on main 6560bedbf at a 1024 px viewport with a 440 px drawer (main column 584 px):\n\n1. Content overflows the main column.\n   - Tasks (/p/<id>/prd): each row's .prd-tag-list (290-379 px wide) and .prd-node-actions (70 px) do not shrink with the column; they end at 611-708 px against the column's right edge at 584 px. Both are flex children of .prd-node-row with flex-shrink: 0 and min-width: auto (styles/prd-tree.css).\n   - Tune reached 885 px against 584 px.\n   - Plan tiles, even with no drawer at 1024 px: the \"N open\" badge overlaps tile titles, and \"Testing & Documentation\" breaks mid-word.\n2. The right \"Next: Work\" stage link covers page content when the drawer is open. Stage links are position: absolute inside .app-body (styles/shell.css .stage-link, .stage-link-next { right: 0 }); .main--staged reserves --stage-link-w as padding on both sides. On Plan with the drawer open the right link covers task rows; this may be bug 1's overflow running under it.\n\nClosing the drawer already gives the full width back on every page and by every close path; the close logic is out of scope."
acceptanceCriteria:
  - "With the drawer open at 1024 px and 1440 px viewport width, on Home, Analysis, Plan, Work, Tasks, Tune and Live, no element inside #main-content has a right edge past #main-content's right edge + 1 px (the brief's console snippet returns [])"
  - "The right stage link covers no page content with the drawer open"
  - "Plan tile badges and titles do not collide, and titles do not break mid-word, at 1024 px with the drawer closed"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "high"
source: "ndx-capture"
---
