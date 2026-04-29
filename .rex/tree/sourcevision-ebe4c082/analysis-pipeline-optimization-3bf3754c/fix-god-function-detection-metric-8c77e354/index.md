---
id: "8c77e354-5210-461d-b84e-d2212f927e8d"
level: "task"
title: "Fix god function detection metric inflation"
status: "completed"
priority: "high"
startedAt: "2026-02-11T18:04:28.014Z"
completedAt: "2026-02-11T18:04:28.014Z"
acceptanceCriteria:
  - "CallGraphView (67 raw calls) is either not flagged or reported with a filtered count that reflects actual user-defined function calls"
  - "Built-in method calls (.map, .filter, .has, .split, .join, .forEach, .reduce, .find, .includes, .toString, .toFixed, etc.) are excluded from god function counts"
  - "Existing god function detection still catches genuinely complex functions"
  - "Unidirectional coupling to a types/helpers module is reported at lower severity than bidirectional coupling"
  - "Utility modules with high fan-in but clean interfaces are classified differently from problematic hotspots"
  - "tree.ts and walkTree are either not flagged or flagged as info-level observations rather than warnings"
description: "detectGodFunctions() in callgraph-findings.ts:95-130 counts all unique callees including built-in/standard-library method calls (.map, .filter, .has, .split, .join, .toFixed, etc.). A Preact component calling 15 real functions + 52 built-in methods gets flagged as \"67 unique function calls\" which is misleading. The call graph extractor in callgraph.ts:374-399 records method calls without distinguishing built-in from user-defined.\n\n---\n\nTwo related issues: (1) detectTightlyCoupledModules() flags routes-rex.ts ↔ types.ts at 129 calls, but this is a large route file (3069 lines) using its companion types module — unidirectional coupling to a helper is different from bidirectional tight coupling. (2) Fan-in detection flags tree.ts (31 callers) and walkTree (22 files) which are fundamental utilities where high fan-in is expected and correct."
---
