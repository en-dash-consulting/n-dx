---
id: "46ebab93-68f7-4dfd-bea6-b3e4f6abc1e0"
level: "task"
title: "Replace hardcoded 'ndx' command references in dashboard UI with project-resolved CLI name"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "identity"
source: "smart-add"
startedAt: "2026-08-14T17:18:46.985Z"
completedAt: "2026-08-14T17:28:57.295Z"
endedAt: "2026-08-14T17:28:57.295Z"
acceptanceCriteria:
  - "All dashboard UI strings that display CLI command syntax reference cliName from shared state instead of hardcoded 'ndx'"
  - "The PR description includes an audit checklist enumerating every changed file and replaced occurrence"
  - "A test or snapshot confirms that setting cliName to 'myapp' updates all visible command labels across at least three distinct dashboard views"
  - "No hardcoded 'ndx' strings remain in dashboard component templates outside of non-display identifiers (e.g. internal route names, config keys, data-testid attributes)"
description: "Audit the web dashboard for all hardcoded 'ndx' strings used as command prefixes in button labels, help text, code snippets, onboarding tips, and the Commands section. Replace each with the cliName value from shared state so users in projects with a different CLI binary name see correct guidance throughout the dashboard."
---
