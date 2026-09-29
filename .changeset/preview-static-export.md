---
"@n-dx/web": patch
---

Add `pnpm preview:export` (`scripts/export-preview-demo.mjs`): writes the option 1 demo page as a static, self-contained HTML file with every page baked into the markup, so the numbers survive wherever scripts are blocked or stopped (mail and chat previews, reader mode, restored tabs). The exported file's own script only shows and hides — navigation, section collapse, the 2D/3D zone-graph toggle, theme.
