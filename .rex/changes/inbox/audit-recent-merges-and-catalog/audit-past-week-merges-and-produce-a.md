---
id: "292dff9b-7b0c-406e-b1db-468128d58a11"
type: "task"
title: "Audit past-week merges and produce a documentation delta report"
slug: "audit-past-week-merges-and-produce-a"
description: "Run git log for the last 7 days on main and feature branches, categorize each merged change by whether it affects the PRD structure, CLI surface, MCP tools, or architectural conventions, and produce a delta report mapping each change to the markdown files that need updating (README.md, CLAUDE.md, AGENTS.md, PACKAGE_GUIDELINES.md, TESTING.md, and per-package READMEs). The recent commits include cross-PRD duplicate detection, branch-scoped PRD file targeting, multi-file PRD migration, and MCP/CLI/dashboard multi-file validation — each of these likely has doc implications."
acceptanceCriteria:
  - "git log --since='7 days ago' output captured and each merge categorized"
  - "Delta report lists every merge with affected doc files and a one-line description of what needs to change"
  - "Report covers at minimum: branch-scoped PRD targeting, cross-PRD duplicate detection, multi-file PRD migration, and multi-file backend validation"
  - "Report identifies documentation files with zero required changes so they can be skipped explicitly"
priority: "high"
tags:
  - "documentation"
  - "audit"
source: "smart-add"
---
