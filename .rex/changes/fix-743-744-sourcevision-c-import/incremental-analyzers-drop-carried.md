---
id: "69f26474-8f93-428a-864e-d345d18e1b6e"
type: "task"
title: "Incremental analyzers drop carried-over entries for files no longer in the inventory"
slug: "incremental-analyzers-drop-carried"
description: "#744. In `analyzeCallGraph`'s incremental branch keep a previous function only when its file is in the current inventory, and a previous edge only when its caller file is in the inventory and its callee file (when set) is too. Apply the same inventory filter to the incremental carry-over in `analyzeImports` (`imports.ts`) and `analyzeComponents` (`components.ts`), and check classifications for the same pattern."
acceptanceCriteria:
  - "With a previous call graph containing functions/edges from a file that is not in the current inventory and fileSetChanged=false, analyzeCallGraph's output contains none of them."
  - "A carried-over edge whose callee file is no longer inventoried loses its calleeFile (null), matching what a full run produces."
  - "The import graph and component catalog incremental paths drop carried-over entries for files not in the current inventory, each covered by a unit test."
  - "Full (non-incremental) results are unchanged."
priority: "high"
tags:
  - "sourcevision"
  - "callgraph"
  - "incremental"
source: "ndx-capture"
---
