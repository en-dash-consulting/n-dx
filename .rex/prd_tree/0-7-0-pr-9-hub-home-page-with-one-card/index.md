---
id: "03d4c9e2-9de7-4567-b4e1-6a21440fe1cd"
level: "epic"
title: "0.7.0 / PR 9 · Hub home page with one card per project"
status: "pending"
priority: "medium"
tags:
  - "parallel-dev"
  - "release-0.7.0"
  - "pr-09"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Home page lists every registered project with live status and links into /p/<id>/."
  - "Unreachable children show a degraded card with a Restart action that calls the hub's respawn."
description: "Release 0.7.0 (minor) · PR 9 of 3 · packages: @n-dx/web · changeset: minor · after PR 8.\n\nThe hub's home page at / (when more than one project is registered, or always at /hub) shows one card per project: name, repo root, current branch and dirty state, active runs, PRD completion, last analysis time, and a Start working shortcut that opens the project dashboard's Runs view with the next actionable task. Data comes from each child's GET /api/status (PR 1 added server identity). Render with the viewer's tokens (packages/web/src/viewer/styles/tokens.css) so light and dark match the dashboards; keep it a small separate entry (like packages/web/src/landing) rather than growing the main viewer bundle.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:13.586Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Hub home page: project cards fed from each child's status route, chooser at / when several projects are registered](./hub-home-page-project-cards-fed-from.md) | pending |
