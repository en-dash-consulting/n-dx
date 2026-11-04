---
id: "63e72261-cf9f-44c2-a845-f600903a6ad2"
type: "task"
title: "The card shortcut never decides a card the operator has not seen"
slug: "the-card-shortcut-never-decides-a-card"
description: "#902 F1 (medium, must-fix). The document-wide ⌘↵/⌘⌫ handler in sidecar-cards.ts checks only defaultPrevented and isTextField. (1) Auto-repeat: with two cards waiting, a held ⌘↵ approves card 1, the listener re-binds to card 2 after the read-back, and the next auto-repeat keydown (e.repeat true) approves card 2. A held ⌘⌫ denies down the queue the same way. (2) Hidden card: SidecarCards stays mounted while the Settings overlay (position fixed, inset 0, opaque, aria-modal) covers the drawer, so ⌘↵ with focus on an overlay button or checkbox approves the card behind it. From M3 on an approval runs the command or ndx work, so this is an unseen approval of real work.\n\nDecided: both of Hal's fixes. Ignore repeat keydowns, and ignore the shortcut while an aria-modal element is open.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #902."
acceptanceCriteria:
  - "The card shortcut ignores a keydown whose repeat flag is set"
  - "The card shortcut decides nothing while an element with aria-modal=\"true\" is open, the Settings overlay included"
  - "Tests: a repeat ⌘↵ keydown after the first approval leaves the second card waiting; ⌘↵ with the Settings overlay open decides no card"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review:#902-F1"
source: "ndx-adversarial-review"
---
