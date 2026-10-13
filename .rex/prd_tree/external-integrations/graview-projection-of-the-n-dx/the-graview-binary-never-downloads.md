---
id: "ef5a6cb4-7fcf-4c4e-9bfb-a9a251e4a0e1"
level: "task"
title: "The graview binary never downloads silently: npx only on explicit opt-in, otherwise an install hint"
status: "completed"
priority: "medium"
tags:
  - "graview"
source: "pr-review:#647"
startedAt: "2026-10-12T23:50:58.766Z"
completedAt: "2026-10-12T23:50:58.766Z"
endedAt: "2026-10-12T23:50:58.766Z"
resolutionType: "code-change"
resolutionDetail: "resolveGraviewCommand returns source \"none\" with an install sentence unless graview.allowNpx or NDX_GRAVIEW_NPX=1 opts in; every command but emit (and serve with a face) stops on it; info says none."
acceptanceCriteria:
  - "With no binary found and no opt-in, every ndx graview command but emit fails with a message naming how to install graview or the face, and runs nothing"
  - "npx is used only when the project config or the environment opts in (e.g. graview.allowNpx: true)"
  - "ndx graview info says which source would be used, including that npx is off"
description: "From the #647 review, point 8. When graview.bin, NDX_GRAVIEW_BIN, PATH and the installed face's own binary all miss, `graview-bin.ts` falls back to `npx -y graview@<GRAVIEW_VERSION>`, which downloads and runs a package at command time and hangs offline. The version already lives in one constant (GRAVIEW_VERSION)."
lastModified: "2026-10-12T23:50:59.040Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
