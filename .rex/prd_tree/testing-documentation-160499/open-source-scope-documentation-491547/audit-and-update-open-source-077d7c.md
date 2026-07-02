---
id: "077d7cf0-8753-42e3-9100-5dc6b758f53a"
level: "task"
title: "Audit and update OPEN_SOURCE_SCOPE.md against current codebase state"
status: "completed"
priority: "medium"
tags:
  - "docs"
  - "open-source"
source: "smart-add"
startedAt: "2026-06-12T14:18:17.291Z"
completedAt: "2026-06-12T14:19:38.874Z"
endedAt: "2026-06-12T14:19:38.874Z"
acceptanceCriteria:
  - "Every package in packages/ is explicitly classified as included or excluded in OPEN_SOURCE_SCOPE.md"
  - "Licensing boundaries section references the correct license identifiers for all included components"
  - "Contribution expectations section is present and describes the contribution process (PRs, issues, code style)"
  - "No stale component names, paths, or descriptions remain in the document"
description: "Review OPEN_SOURCE_SCOPE.md content against the current monorepo structure, package list, and licensing to verify that included components (sourcevision, rex, hench, llm-client, web, core), excluded components, licensing boundaries, and contribution expectations are accurate and complete. Update any stale sections to reflect the current state of the project."
---
