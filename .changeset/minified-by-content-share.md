---
"@n-dx/sourcevision": patch
---

A `.js`, `.mjs`, `.cjs` or `.css` file whose name does not say minified is now marked `generated` by content only when lines over 2,000 characters fill at least half of its first 64 KiB. A hand-written file with one inline data URI, SVG or JSON line keeps its role and stays in `callgraph.json` and `components.json`; a bundle behind a licence banner is still generated. Name rules are unchanged, and cached inventories are recomputed.

`analyze` now prints one line counting the files marked `generated` by content, naming the first three, so a wrong mark is noticed.
