---
id: "e6dc973a-e7fd-49cc-92f9-45f675c5c0d7"
type: "task"
title: "The uncommitted-files panel stays on screen at narrow widths"
slug: "the-uncommitted-files-panel-stays-on"
description: "#902 F3 (medium, should-fix; affects the dashboard with the Sidecar off). git-status.css anchors the commit/discard/ignore panel with position absolute; right 0 on a chip that sits left of the bottom bar's controls, while the panel is 420px wide. Below about 700px the panel runs off the viewport's left edge with no way to scroll it back. Hal measured 193 of 358px hidden at 390px, 114px at 560px and 34px at 640px. Before M2 the panel lived in the fixed bottom-right status dock and always fit. Hal also noted shell.spec.ts's phone-width stacking test still injects a .sessions-panel whose CSS M2 deleted, so it passes without exercising a real tray.\n\nDecided: option (a). At narrow widths anchor the panel to the viewport (fixed, right 1rem, above the bottom bar).\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #902."
acceptanceCriteria:
  - "At viewport widths where the chip-anchored panel would cross the left edge, the uncommitted-files panel is anchored to the viewport above the bottom bar and its bounding box is inside the viewport"
  - "shell.spec.ts opens the chip at 390px and asserts the panel is fully inside the viewport"
  - "The phone-width stacking test no longer injects a .sessions-panel"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review:#902-F3"
source: "ndx-adversarial-review"
---
