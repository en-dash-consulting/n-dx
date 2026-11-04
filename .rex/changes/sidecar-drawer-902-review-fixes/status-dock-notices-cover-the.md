---
id: "6fb793c3-adec-4532-bce2-a190545601b9"
type: "task"
title: "Status-dock notices cover the uncommitted-files panel at narrow widths"
slug: "status-dock-notices-cover-the"
description: "Found by the adversarial review of e6dc973a (commit 85edb3626). Verdict: should-fix, low.\n\nScenario: viewport ≤700px, the uncommitted-files panel is open. git-status.css now fixes it at right 1rem, bottom calc(var(--bottombar-h) + 0.5rem). status-dock.css fixes .status-dock at right calc(1rem + var(--sidecar-w, 0px)), bottom calc(1rem + var(--bottombar-h)), z-index var(--z-tray) in the root stacking context. The panel's z-index is var(--z-tray) too, but inside .bottombar (position relative, z-index 41), which is its own stacking context, so it paints below the dock. Any notice in the dock (refresh-toast, rex-toast, polling-suspension-indicator, ...) shown while the panel is open is drawn over the panel's lower part, where the commit message and the Commit/Discard buttons are. Before M2 the panel lived in the dock and stacked with the notices. At wide widths the chip-anchored panel can partly overlap the dock too (pre-existing from M2).\n\nReachable: open the chip on a phone-width dashboard while a refresh or an audit notice is showing, or while polling is suspended.\n\nOptions:\n(a) At ≤700px, when the panel is open, raise the bottom bar's stacking (for example a .bottombar:has(.git-status-panel) z-index above --z-tray). Cheap, but it also lifts the bar over the dock's notices.\n(b) Offset the panel above the dock, or the dock above the panel, while both show. More layout coupling.\n(c) Hide or step the dock aside while the panel is open.\nRecommended: (a), scoped to the open panel. Decide whether notices may sit under the panel."
acceptanceCriteria:
  - "At 390px, with the uncommitted-files panel open and a notice in the status dock, the panel's commit controls are not covered: elementFromPoint at the Commit button's centre returns the button"
  - "A Playwright test in shell.spec.ts opens the chip at 390px, injects a status-dock notice, and asserts the Commit button is the topmost element at its own centre"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "review:e6dc973a"
source: "ndx-adversarial-review"
---
