---
id: "797f4262-3835-4bcc-9ad8-72ef8a196ef4"
level: "feature"
title: "Robot Wrangler stack 4/9 · Robot Wrangler server: readiness, tiers, failover, review and preview"
status: "completed"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
startedAt: "2026-10-11T04:33:50.360Z"
completedAt: "2026-10-11T05:10:06.769Z"
endedAt: "2026-10-11T05:10:06.769Z"
acceptanceCriteria:
  - "The page can be built from GET /api/llm/config, GET /api/llm/catalog and POST /api/llm/config/preview alone."
  - "No route returns a credential value."
description: "Everything the redesigned Robot Wrangler page shows, resolved on the server, so the page keeps its rule of rendering what the route resolved and applying no rules of its own. This adds:\n\n- each vendor's readiness;\n- the model tier table with what each tier is used by;\n- Heavy-tier saves;\n- whether failover can fire;\n- the review settings;\n- a preview route that answers \"what will run\" for unsaved edits.\n\nThis is PR 4 of the 9-PR Robot Wrangler stack. Routes live in `packages/web/src/server/routes-llm.ts`, with resolution in `effective-agent-config.ts` and the catalog in `llm-catalog.ts`.\n\nGoal: GET /api/llm/config and /api/llm/catalog answer every question the new page asks."
lastModified: "2026-10-11T05:10:07.046Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Accept Heavy and Free tier model saves through PUT /api/llm/config](./accept-heavy-and-free-tier-model-saves.md) | completed |
| [Add POST /api/llm/config/preview, which resolves unsaved edits without writing them](./add-post-api-llm-config-preview-which.md) | completed |
| [Describe whether failover can fire from GET /api/llm/config](./describe-whether-failover-can-fire.md) | completed |
| [Report each vendor's readiness from GET /api/llm/catalog](./report-each-vendor-s-readiness-from.md) | completed |
| [Report failover's enabled flag and the full chain even when failover cannot fire](./report-failover-s-enabled-flag-and-the.md) | completed |
| [Serve and save the review settings, with a pairSupported flag, through /api/llm/config](./serve-and-save-the-review-settings.md) | completed |
| [Serve the model tier table, with what each tier is used by, from GET /api/llm/config](./serve-the-model-tier-table-with-what.md) | completed |
| [Stop the tier table from declaring unregistered task classes that fail the task-class registry contract](./stop-the-tier-table-from-declaring.md) | completed |
