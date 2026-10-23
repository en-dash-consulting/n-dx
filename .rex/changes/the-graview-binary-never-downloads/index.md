---
id: "ef5a6cb4-7fcf-4c4e-9bfb-a9a251e4a0e1"
type: "change"
title: "The graview binary never downloads silently: npx only on explicit opt-in, otherwise an install hint"
slug: "the-graview-binary-never-downloads"
intent: "From the #647 review, point 8. When graview.bin, NDX_GRAVIEW_BIN, PATH and the installed face's own binary all miss, `graview-bin.ts` falls back to `npx -y graview@<GRAVIEW_VERSION>`, which downloads and runs a package at command time and hangs offline. The version already lives in one constant (GRAVIEW_VERSION)."
acceptanceCriteria:
  - "With no binary found and no opt-in, every ndx graview command but emit fails with a message naming how to install graview or the face, and runs nothing"
  - "npx is used only when the project config or the environment opts in (e.g. graview.allowNpx: true)"
  - "ndx graview info says which source would be used, including that npx is off"
touches:
  - "1fadb108-b5a8-405c-8699-bdba069663fc"
priority: "medium"
tags:
  - "graview"
source: "pr-review:#647"
---
