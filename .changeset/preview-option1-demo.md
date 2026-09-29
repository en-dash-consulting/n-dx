---
"@n-dx/web": patch
---

Preview: add `option1-demo.html`, a hand-built rendering of the option 1 layout filled with this repo's real analysis, PRD and run data — three product pages (Analysis, Plan, Work) of named dropdown sections, with the 2D and isometric zone graphs sharing one panel behind a toggle. Reachable from the editor header ("Demo ↗"). The preview server now serves sibling HTML pages with live reload and folds their timestamps into the change fingerprint, and the build copies every page in `src/preview/` into `dist/`.
