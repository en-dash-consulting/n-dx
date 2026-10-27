---
id: "15afdaf1-e70e-4be2-a5a7-4c6fcb4486b4"
type: "change"
title: "Audit functions lacking dashboard UI coverage"
slug: "audit-functions-lacking-dashboard-ui"
intent: "Enumerate all functions, commands, and capabilities across the packages (ndx orchestration commands, rex/sourcevision/hench CLI commands, MCP tools) and compare against current dashboard pages/sections. Produce a gap inventory listing each function with: current UI coverage (full/partial/none), the proposed page or section to host it, and any exclusions with rationale."
acceptanceCriteria:
  - "Gap inventory covers ndx orchestration commands, package CLIs, and MCP tools"
  - "Each entry states coverage level and proposed UI placement or exclusion rationale"
  - "Inventory is checked into the repo or attached to this PRD item"
touches:
  - "d7f5ba08-a413-44f2-a560-0423be6b4413"
priority: "high"
tags:
  - "web"
  - "audit"
source: "ndx-capture"
---
