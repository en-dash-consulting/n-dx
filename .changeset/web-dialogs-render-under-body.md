---
"@n-dx/web": patch
---

The Prepare task modal no longer has the Work page painted over it. Opened from
the "Up next" card, it sat inside that card's `z-index: 1` stacking context, so
the panels beside the card drew on top. It now renders under `<body>`, as do
the Guide and FAQ overlays, which were capped the same way by the top nav and
the bottom bar.
