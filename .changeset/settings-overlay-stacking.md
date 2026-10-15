---
"@n-dx/web": patch
---

The settings overlay no longer has the page beneath it painting over the top. Opening PRD settings from the work page showed that page's text and controls sitting over the modal.

The overlay was at a bare `z-index: 60` while the status trays, banners and toasts that render as its siblings sat between 100 and 10001 — and because the page below stays mounted when settings opens, all of it kept painting. Every component had picked its own number and nothing compared them, so the conflict was invisible.

App-level stacking is now one `--z-*` scale in `styles/tokens.css`, from the header up through trays, banners, toasts, page-owned dialogs, full-page overlays, shell dialogs, crash recovery and the accessibility skip link. The overlay sits above everything a page can render, while a dialog opened from inside it — the unsaved-changes prompt — still sits above the overlay. Local stacking inside a single component is deliberately not part of the scale.

Two orderings that were easy to lose are kept explicitly: the memory warning stays above the degradation banner, and crash recovery stays reachable above a stuck overlay.

A new test reads the real stylesheets and fails if any of those relationships inverts, or if an app-level layer goes back to a raw number.
