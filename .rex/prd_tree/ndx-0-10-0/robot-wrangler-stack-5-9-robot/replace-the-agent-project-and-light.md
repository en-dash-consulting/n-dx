---
id: "cde76eae-29c1-4e87-ba0a-c1cb293eb873"
level: "task"
title: "Replace the agent, project and light model fields with a tier table that shows what each tier is used by"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
blockedBy:
  - "8986a809-6174-413f-a1a5-fdd14cd6fb76"
  - "962e9867-2ef4-41af-b729-5a396c374d49"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "The table renders one row per tier from GET /api/llm/config with its used-by labels and source."
  - "Setting Heavy saves llm.tiers.<vendor>.heavy; clearing it removes the key."
  - "Unset and set rows are visually distinct and the unset option names the resolved model."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "**Section 3, \"Models\"** (subtitle \"Commands and tasks pick a tier; you pick the model for each\"). The header's right side shows the model list source and a Refresh button.\n\nOne row per tier from the server's `tiers` array: Agent model, Standard, Light, Heavy, and Free only when present. Each row has three columns:\n- the tier name, with \"Used by <labels>\" in small monospace;\n- a model select, whose first option is the unset choice labelled with what it resolves to, followed by the catalog's models and \"Other model id…\" for free entry;\n- \"Runs as <model>\" for an unset row, or \"Set in <key>\" for a set one.\n\nUnset rows get a dashed, muted select; set rows a solid one.\n\nThe rows write `hench.models.<vendor>`, `llm.<vendor>.model`, `llm.<vendor>.lightModel` and `llm.tiers.<vendor>.heavy` / `.free`.\n\nFooter note: \"Agent model overrides Standard for ndx work only. A --model flag or a task's saved run settings win for that run.\"\n\nThe Local vendor's selects use the live list from the local server."
lastModified: "2026-10-10T23:40:53.172Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
