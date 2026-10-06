---
id: "a1107d3c-20b9-4966-ac86-bed72046c93d"
level: "task"
title: "Rewrite the guidance, schema doc, public surface and policies"
status: "pending"
priority: "high"
tags:
  - "pr-24"
  - "lane-core-docs"
  - "core"
blockedBy:
  - "d5f63839-3cc0-4b06-8479-b03e879c12e9"
source: "roadmap"
acceptanceCriteria:
  - "Policy tests assert the new invariant"
  - "The public-surface doc lists the schema, every rex and sourcevision MCP tool (naming any marked experimental), the bundle, paths and trailer format"
  - "AGENTS.md and CLAUDE.md carry the same invariant text"
description: "Rewrite the PRD invariant (.ndx/rex/product and .ndx/rex/changes are the only writable PRD surfaces), the concurrency contract, the folder-tree schema doc as the v2 schema doc, a public-surface doc listing what 1.0.0 freezes (the PRD schema, the MCP tools of both servers, rex and sourcevision, the bundle format, the .ndx/ paths and the trailer format; a tool listed there as experimental stays changeable until promoted), host-neutral merge requirements, gateway counts in CLAUDE.md, and move the architecture and invariant policy tests to the two roots."
lastModified: "2026-10-06T17:53:06.010Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
