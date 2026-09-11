---
id: "6f00e7e9-34ce-4519-be4b-e2323d8a2476"
level: "epic"
title: "0.8.0 / PR 13 · Workspaces Overview view, PRD delta versus the anchor, workspace-scoped writes"
status: "pending"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.8.0"
  - "pr-13"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Overview view shows agent slots, memory, dirty trees and items-only-on-branches tiles above one card per worktree with live run, last output line, uncommitted count, PRD delta count and Open / Start working / Stop actions."
  - "GET /api/workspaces/:wt/prd-delta returns added, changed and completed ids versus the anchor."
  - "Editing a task while viewing worktree B writes to B's tree."
description: "Release 0.8.0 (minor) · PR 13 of 5 · packages: @n-dx/web · changeset: minor · after PR 12.\n\nThe monitoring surface: a Workspaces Overview view (new WORKSPACES sidebar section, single item \"Overview\") with a machine strip and one card per worktree, a server-side PRD delta versus the anchor, and dashboard writes routed to the selected workspace's tree. It replaces the read-only Sessions pill from PR 5 (remove the pill; keep its data hook).\n\nUI direction: the recommended composite from the 'Worktree Workspaces UI' canvas (Main artboard): the breadcrumb branch chip becomes the workspace switcher, a new WORKSPACES sidebar section holds one item \"Overview\" that opens a board of worktree cards under a machine strip, cards carry a PRD delta count chip, and HENCH is shown collapsed when the section is present. Match tokens.css / layout.css exactly; new elements use existing badge, chip, card and pill classes.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:28.904Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Dashboard writes go to the selected workspace's tree; editing the anchor while viewing a branch requires an explicit switch](./dashboard-writes-go-to-the-selected.md) | pending |
| [PRD delta versus the anchor computed server-side and exposed at /api/workspaces/:wt/prd-delta](./prd-delta-versus-the-anchor-computed.md) | pending |
| [Workspaces Overview view: machine strip, one card per worktree with live run, PRD delta count and Open / Start working / Stop; new WORKSPACES sidebar section](./workspaces-overview-view-machine-strip.md) | pending |
