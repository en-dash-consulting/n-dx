---
id: "d62e3a3f-ee58-4d87-bcef-a5e9779a88de"
type: "task"
title: "A selected spec-map block looks the same as the keyboard-focused block"
slug: "a-selected-spec-map-block-looks-the"
description: "Found by an adversarial review of 18fc7905. In packages/web/src/viewer/styles/product.css, `.pam-block[aria-pressed=\"true\"]` draws `outline: 2px solid var(--accent); outline-offset: 2px`, the same outline as `.pam-block:focus-visible`. Scenario: select a block in the area view, then press Tab to the next block. Two blocks now have identical outlines, and a sighted keyboard user cannot tell which one has focus and which one is selected. Screen readers are fine because aria-pressed is announced. Reachable from /product/area/<slug> and from the in-place area view on Plan. Verdict: should-fix, low. Options: (a) give the selected block a different look, such as a thicker inset border or a box-shadow ring in another colour, keeping the outline for focus only (recommended: CSS only, no risk); (b) do this as part of the sibling task that shows the selected capability's detail in place, which redesigns selection anyway."
acceptanceCriteria:
  - "A selected spec-map block and a keyboard-focused spec-map block are drawn with different styles"
  - "When a block is selected and another block has focus, the selected one can be told apart from the focused one without a screen reader"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
