---
id: "69f26474-8f93-428a-864e-d345d18e1b6e"
level: "task"
title: "Incremental analyzers drop carried-over entries for files no longer in the inventory"
status: "pending"
priority: "high"
tags:
  - "sourcevision"
  - "callgraph"
  - "incremental"
source: "ndx-capture"
acceptanceCriteria:
  - "With a previous call graph containing functions/edges from a file that is not in the current inventory and fileSetChanged=false, analyzeCallGraph's output contains none of them."
  - "Edges whose callee file is no longer inventoried are dropped from the incremental result."
  - "The import graph and component catalog incremental paths drop carried-over entries for files not in the current inventory, each covered by a unit test."
  - "Full (non-incremental) results are unchanged."
description: "#744. In `analyzeCallGraph`'s incremental branch keep a previous function only when its file is in the current inventory, and a previous edge only when its caller file is in the inventory and its callee file (when set) is too. Apply the same inventory filter to the incremental carry-over in `analyzeImports` (`imports.ts`) and `analyzeComponents` (`components.ts`), and check classifications for the same pattern."
lastModified: "2026-10-15T01:44:08.176Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
