---
id: "1e5bf051-8d47-4dbd-be8e-ff264b6d7f22"
type: "change"
title: "Placement mode's proposed-capability ghost block is pulled out of the map by the generic .pam-ghost marker rule"
slug: "placement-mode-s-proposed-capability"
intent: "Found by the adversarial review of 8722270b (ghost markers on the area view's spec map); pre-existing, introduced by f109dea8a.\n\nDefect: packages/web/src/viewer/styles/product.css:923 styles the waiting-card marker as a bare `.pam-ghost { position: absolute; bottom; right; border-radius: 999px; ... }`. Placement mode's GhostBlock (area-spec-map.ts, class `pam-block pam-ghost`) shares the class; `.pam-block.pam-ghost` (line 896) sets only border/background/cursor, so the later bare rule makes the proposed-capability block absolutely positioned, pill-shaped and muted.\n\nScenario: Plan → place an Inbox change → open the proposal form so a proposed capability is drawn → the dashed \"proposed\" block leaves the flex row and sits in the bottom-right corner of the nearest positioned ancestor, overlapping real blocks.\n\nReachable: yes, placement mode's proposal form (placement-mode.ts passes `ghost` to SpecMap). Not covered: jsdom unit tests do not apply CSS.\n\nOptions: (A, recommended) rename the marker class to `.pam-ghost-mark` in product-area-map.ts and the CSS (and tests querying it) — cheap, removes the collision. (B) scope the rule as `.pam-block > .pam-ghost` — smaller diff, keeps the ambiguous class.\n\nVerdict: out-of-scope for 8722270b (pre-existing), severity medium."
acceptanceCriteria:
  - "The proposed-capability ghost block in placement mode stays in the spec map's flex row and is not absolutely positioned"
  - "The waiting-card +N marker and the proposed-capability ghost block no longer share a CSS class"
  - "A test asserts the marker and the ghost block carry distinct classes"
touches:
  - "2e233c46-e4fb-49d1-81e7-6e0fd58fc683"
priority: "medium"
discoveredFrom: {"item":"8722270b-60ea-428e-904e-deb8ded883d8","run":"22fe0466-ad9c-4d15-ad19-2f91941b1f1b"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
