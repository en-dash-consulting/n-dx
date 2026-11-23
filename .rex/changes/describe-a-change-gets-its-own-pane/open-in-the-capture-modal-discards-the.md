---
id: "e40bc7d7-a476-4bd6-99e8-e815c9ff9b2a"
type: "task"
title: "Open ↗ in the capture modal discards the typed description"
slug: "open-in-the-capture-modal-discards-the"
summary: "Clicking 'Open' in the expanded capture view jumps to the full page with an empty box, losing what the person typed. This carries the text across."
description: "Verdict: should-fix (severity high), from the adversarial review of feat/capture-pane-modal.\n\nTrigger: type a long description in the modal → click Open ↗ → the Add Items page opens with an empty textarea. stage-tiles.ts:188-195 gives every modal Open ↗ → navigateTo('analysis'); CaptureDraftProvider wraps only Plan's renderer (view-registry.ts:193), so /analysis renders AnalysisView with no provider and an empty draft. The old lead section had no Open ↗ beside the form.\n\nFix (recommended, ~5 lines, low risk): mount CaptureDraftProvider above the router (app root in main.ts) so Plan and /analysis share one draft, including images once they are shared. Alternative: suppress Open ↗ on the capture tile."
acceptanceCriteria:
  - "Text typed in the capture modal is still in the form after clicking Open ↗"
  - "Text typed on the /analysis page is still in the Plan capture tile after navigating back to Plan"
  - "A test types in the modal, clicks Open ↗, and asserts the text is present"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
