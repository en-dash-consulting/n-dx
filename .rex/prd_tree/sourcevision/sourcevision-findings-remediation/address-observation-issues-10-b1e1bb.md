---
id: "b1e1bbdd-6c29-43f3-a955-cb962e38636a"
level: "task"
title: "Address observation issues (10 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T04:46:13.996Z"
completedAt: "2026-03-08T04:55:13.211Z"
acceptanceCriteria: []
description: "- cli-contract.test.mjs is the only .mjs file among .js peers — standardize to one extension to avoid potential vitest/jest config edge cases with module resolution.\n- Bidirectional coupling: \"mcp-route-layer\" ↔ \"web-dashboard\" (3+2 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 23 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.6) — 3 imports target \"web-dashboard\"\n- Coupling of 0.6 is elevated for a 3-file zone; the mutual import relationship with web-dashboard (each zone imports from the other) is the primary driver — extracting shared types into a dedicated types module would reduce coupling on both sides.\n- Low cohesion (0.33) — files are loosely related, consider splitting this zone\n- Coupling of 0.67 exceeds the healthy threshold and is an artifact of the misclassified viewer files; resolving zone membership will likely bring coupling back into range without any code changes.\n- Three viewer source files (elapsed-time.ts, route-state.ts, task-audit.ts) are listed as entry points for this zone but belong in the web-viewer zone per developer-provided hints — zone membership correction is needed to restore accurate cohesion and coupling metrics.\n- 9 entry points — wide API surface, consider consolidating exports\n- Circular import relationship with the MCP Route Layer zone (web-viewer → web-server: 2 imports, web-server → web-viewer: 3 imports) suggests shared types or utilities that could be extracted to a shared module to eliminate the cycle."
recommendationMeta: "[object Object]"
---
