---
id: "66437fad-2881-47b9-9e37-8c9c34bbd600"
type: "change"
title: "Diagnose why the auto-commit step does not fire after MCP-driven PRD mutations in Claude Code skills"
slug: "diagnose-why-the-auto-commit-step-does"
intent: "Examine the auto-commit implementation in the file-modifying skills (particularly /ndx-capture) to identify whether the commit gate checks only direct file edits, ignores MCP-side-effect writes, or runs a working-directory check that returns clean because MCP writes land outside the watched path. Confirm whether git status --porcelain is invoked at all and whether its output is correctly interpreted when prd_tree files are staged."
acceptanceCriteria:
  - "Root cause is identified: whether the commit gate skips MCP-dirtied files, the porcelain check runs against the wrong directory, or the condition short-circuits early"
  - "Reproduction steps documented for /ndx-capture producing a dirty prd_tree without triggering auto-commit"
touches:
  - "efac37e0-dc05-4140-b0e1-dfb3e24b6f7e"
priority: "high"
tags:
  - "skills"
  - "auto-commit"
  - "bug"
  - "mcp"
source: "smart-add"
---
