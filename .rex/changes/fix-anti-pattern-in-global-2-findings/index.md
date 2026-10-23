---
id: "c4e93fb7-645d-495d-ade0-9bdff9cbb75c"
type: "change"
title: "Fix anti-pattern in global (2 findings)"
slug: "fix-anti-pattern-in-global-2-findings"
intent: "- God function: analyzeImports in packages/sourcevision/src/analyzers/imports.ts calls 41 unique functions — consider decomposing into smaller, focused functions\n- God function: runCI in packages/core/ci.js calls 39 unique functions — consider decomposing into smaller, focused functions"
touches:
  - "af2a209a-d1d4-48d5-aaee-7ecb4a33565c"
priority: "high"
source: "sourcevision"
---
