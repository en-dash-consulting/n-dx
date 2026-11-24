---
id: "b9d46bbf-4ace-4af9-bccc-3c0ca8bff6fb"
type: "change"
title: "Escape closes every open dashboard layer at once instead of the topmost"
slug: "escape-closes-every-open-dashboard"
summary: "Pressing Escape in a dialog opened from inside another panel or full-screen tile closes both at once, which can throw away unsaved choices in the inner one. Escape should close only the layer on top."
intent: "Failure: components/use-escape-key.ts adds a window keydown listener per active layer and calls every one on Escape, with no notion of which layer is on top. Trigger: Work › PRD tools side panel → Reorganize; press Escape: the side panel closes too and unmounts the Reorganize slide-out with its unapplied selection. The same holds for a dialog opened inside a full-screen tile. Reachability: any nested layer; pre-existing (every tile modal behaves this way), made more visible by the side panels in efcc0da8e. Verdict: out-of-scope for that change (low). Options: (a, recommended) a small layer stack in useEscapeKey — the last-activated layer handles Escape and stops it; (b) each inner layer calls stopPropagation on a capture-phase listener — easy to miss per component."
acceptanceCriteria:
  - "With a dialog open inside a side panel or full-screen tile, Escape closes only the dialog (unit test)"
  - "A second Escape then closes the outer layer"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
