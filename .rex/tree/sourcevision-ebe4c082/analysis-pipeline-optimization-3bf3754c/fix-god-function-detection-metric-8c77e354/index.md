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

## Subtask: Filter built-in method calls from god function detection

**ID:** `0f34b24b-6b4a-46dc-9b6e-982c06859e35`
**Status:** completed
**Priority:** high

In callgraph-findings.ts:95-130, detectGodFunctions() counts all unique callees including built-in/standard-library methods (.map, .filter, .has, .split, .join, .forEach, .reduce, .find, .includes, .toString, .toFixed, etc.), inflating counts (e.g., CallGraphView reported as 67 calls when ~15 are user-defined). Add a built-in method filter set and exclude callees whose name matches AND whose call type is "method" (not direct calls, to avoid filtering user-defined functions named "filter"). Add unit tests covering: function with 35 user-defined calls IS flagged, function with 15 user-defined + 50 built-in methods is NOT flagged, direct call to a function named "filter" IS counted, threshold boundary behavior.

**Acceptance Criteria**

- God function detection excludes built-in method calls from unique callee count
- CallGraphView drops from 67 to a more accurate count reflecting user-defined calls only
- The filter only applies to method-type calls, not direct calls (a user-defined function named 'filter' called directly is still counted)
- pnpm test passes for sourcevision package
- Test file exists covering all 4 cases
- All tests pass

---

## Subtask: Refine tight coupling and fan-in detection heuristics

**ID:** `5dde9f98-83c9-4db7-a25a-cf998792ed71`
**Status:** completed
**Priority:** medium

Two related improvements in callgraph-findings.ts: (1) Tight coupling (lines 141-191): A 3000-line route file making 129 unidirectional calls to its companion types module is expected, not problematic. Downgrade severity for unidirectional coupling (p.ba near zero) to info, especially when the target is a types/constants file. (2) Fan-in (lines 345-418): tree.ts (31 callers) and walkTree (22 files) are fundamental utilities where high fan-in is correct. Add a utility module heuristic: files in /core/, /utils/, /helpers/, or /lib/ directories get a higher warning threshold (e.g., 2x normal). Both changes should include tests.

**Acceptance Criteria**

- routes-rex.ts → types.ts coupling is either not flagged or flagged at info severity
- Bidirectional tight coupling between two large implementation files is still flagged at warning/critical
- pnpm test passes
- tree.ts fan-in is either not reported as a warning or is reported as an info-level observation noting it as a utility module
- walkTree hub finding is similarly downgraded
- A non-utility file with the same fan-in count is still flagged at warning

---
