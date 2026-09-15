---
id: "d3c822e4-7d47-447f-b0fa-eca2c3791417"
level: "epic"
title: "0.8.0 / PR 12 · /w/:wt/ URL slot, workspace-tagged WebSocket frames, breadcrumb workspace switcher"
status: "pending"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.8.0"
  - "pr-12"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "/w/<wt>/<view> deep links resolve; links without the slot resolve to the anchor."
  - "A PRD change in worktree B refreshes only tabs viewing B."
  - "The breadcrumb chip opens a dropdown listing worktrees with anchor, running and dirty state, and switching updates the URL and every view."
description: "Release 0.8.0 (minor) · PR 12 of 5 · packages: @n-dx/web · changeset: minor · after PR 11.\n\nAdds the workspace dimension to the viewer: a /w/:wt/ slot in front of the view id (packages/web/src/shared/view-routing.ts, viewer/route-state.ts, use-route-state.ts, server routes-static.ts SPA catch-all), WebSocket frames tagged with { workspace } and filtered client-side (websocket.ts broadcast is currently one flat set; use-prd-websocket.ts refetches on every rex:prd-changed), and the breadcrumb branch chip becoming the switcher.\n\nUI direction: the recommended composite from the 'Worktree Workspaces UI' canvas (Main artboard): the breadcrumb branch chip becomes the workspace switcher, a new WORKSPACES sidebar section holds one item \"Overview\" that opens a board of worktree cards under a machine strip, cards carry a PRD delta count chip, and HENCH is shown collapsed when the section is present. Match tokens.css / layout.css exactly; new elements use existing badge, chip, card and pill classes.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:25.135Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [/w/:wt/ URL slot in viewer routing and server dispatch; default workspace is the anchor; slot-less deep links still resolve](./w-wt-url-slot-in-viewer-routing-and.md) | pending |
| [Workspace-tagged WebSocket frames with client-side filtering, and the breadcrumb workspace switcher](./workspace-tagged-websocket-frames-with.md) | pending |
