---
id: "67617647-fe82-4ea1-b023-d0a3124a979b"
level: "task"
title: "Document recommended .gitignore for ndx and ship a reference template"
status: "completed"
priority: "medium"
tags:
  - "documentation"
  - "onboarding"
  - "git"
source: "smart-add"
startedAt: "2026-05-14T19:01:29.135Z"
completedAt: "2026-05-14T19:05:51.531Z"
endedAt: "2026-05-14T19:05:51.531Z"
resolutionType: "code-change"
resolutionDetail: "Created docs/guide/gitignore.md and packages/core/assistant-assets/ndx.gitignore; updated quickstart, getting-started, existing-project, README, and vitepress sidebar to surface the guidance."
acceptanceCriteria:
  - "README (or a linked docs page) includes a section explaining what to gitignore for ndx projects and why"
  - "Documentation provides a copy-pasteable .gitignore snippet that excludes .sourcevision/, .hench/, .rex/* except .rex/prd_tree/, .n-dx-web.pid, .run-logs/, and other transient files"
  - "A reference template file is committed (e.g. assistant-assets/ndx.gitignore or docs/ndx.gitignore.example) and linked from the docs"
  - "Quick Start / onboarding guide links to the gitignore guidance so new users see it during setup"
  - "The recommended ignore patterns are verified against the current set of ndx-generated paths in CLAUDE.md's Key Files table"
description: "Add user-facing guidance explaining which ndx-generated files and directories are transient runtime artifacts versus durable project state, and recommend that users gitignore everything except the PRD folder tree (`.rex/prd_tree/`). Ship a copy-pasteable example `.gitignore` snippet in the documentation and a reference template file in the repo that users can drop into new projects. Surface this guidance in the Quick Start / onboarding flow so it is encountered early."
---
