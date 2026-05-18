---
id: "10e8d95b-b703-4ed1-9c9b-da0e0c623b0a"
level: "task"
title: "Audit contributor page and add Prerequisites, Setup Steps, and Development Setup sections"
status: "completed"
priority: "medium"
tags:
  - "documentation"
  - "contributor-experience"
source: "smart-add"
startedAt: "2026-05-18T13:08:07.356Z"
completedAt: "2026-05-18T13:10:43.304Z"
endedAt: "2026-05-18T13:10:43.304Z"
resolutionType: "code-change"
resolutionDetail: "Added Prerequisites and Setup Steps sections to CONTRIBUTING.md; added dev-link subsection (§6) to existing Development setup section."
acceptanceCriteria:
  - "Contributor page contains Prerequisites, Setup Steps, and Development Setup sections (added only if missing — existing sections untouched)"
  - "Prerequisites section lists Node.js ≥18 (22 LTS recommended) and pnpm ≥10 with platform support matrix reference"
  - "Setup Steps section provides a copy-pasteable sequence to get from fresh clone to passing `pnpm build`"
  - "Development Setup section documents `pnpm build`, `pnpm test`, `pnpm typecheck`, and how to test changes against a real project via dev-link"
  - "No duplicate content with root README — cross-link where overlap would otherwise occur"
description: "Locate the contributor page (likely CONTRIBUTING.md or docs/contributing.md), inventory which of the five target sections already exist, and add Prerequisites, Setup Steps, and Development Setup sections if absent. Prerequisites covers Node ≥18, pnpm ≥10, and platform support notes. Setup Steps covers clone/install/build. Development Setup covers running the monorepo locally (pnpm build, pnpm test, pnpm typecheck) and how to link a local build via the dev-link skill. Reuse content from the existing Developer Environment Prerequisites guide and root README where possible to avoid drift."
---
