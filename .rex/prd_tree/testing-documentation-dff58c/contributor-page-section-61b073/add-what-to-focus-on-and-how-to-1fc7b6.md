---
id: "1fc7b668-07cf-49cb-94d1-068877751514"
level: "task"
title: "Add What to Focus On and How To Contribute sections to contributor page"
status: "completed"
priority: "medium"
tags:
  - "documentation"
  - "contributor-experience"
source: "smart-add"
startedAt: "2026-05-18T13:04:57.681Z"
completedAt: "2026-05-18T13:07:54.431Z"
endedAt: "2026-05-18T13:07:54.431Z"
resolutionType: "code-change"
resolutionDetail: "Added What to Focus On (3 avenues: self-heal items, help-wanted tags, doc gaps) and How To Contribute (branch/commit/PR flow, pre-commit gates, ndx ci health gate, N-DX-* trailer conventions, PRD-linked commits) to CONTRIBUTING.md. Sections positioned to match the required five-section order."
acceptanceCriteria:
  - "Contributor page contains What to Focus On and How To Contribute sections (added only if missing)"
  - "What to Focus On lists at least three concrete contribution avenues (e.g., open self-heal items, documentation gaps, test coverage areas)"
  - "How To Contribute documents the branch → commit → PR flow including pre-commit gates (`pnpm test`, `pnpm typecheck`) and the n-dx authorship trailer convention"
  - "How To Contribute links to or summarizes the PRD-status commit trailer pattern so contributors understand the rex/hench integration"
  - "Section order in the final document matches the requested sequence: Prerequisites, Setup Steps, What to Focus On, Development Setup, How To Contribute"
description: "Append What to Focus On and How To Contribute sections to the contributor page if not already present. What to Focus On should point new contributors at high-leverage areas (e.g., self-heal findings, open PRD items tagged help-wanted, documentation gaps catalogued in recent audits). How To Contribute should describe the branching/commit/PR workflow including the hench commit trailer conventions, the `ndx ci` health gate, and how PRD items are linked to commits. Both sections should be skimmable for someone making their first contribution."
---
