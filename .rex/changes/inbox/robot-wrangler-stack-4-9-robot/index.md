---
id: "797f4262-3835-4bcc-9ad8-72ef8a196ef4"
type: "change"
title: "Robot Wrangler stack 4/9 · Robot Wrangler server: readiness, tiers, failover, review and preview"
slug: "robot-wrangler-stack-4-9-robot"
intent: "Everything the redesigned Robot Wrangler page shows, resolved on the server, so the page keeps its rule of rendering what the route resolved and applying no rules of its own. This adds:\n\n- each vendor's readiness;\n- the model tier table with what each tier is used by;\n- Heavy-tier saves;\n- whether failover can fire;\n- the review settings;\n- a preview route that answers \"what will run\" for unsaved edits.\n\nThis is PR 4 of the 9-PR Robot Wrangler stack. Routes live in `packages/web/src/server/routes-llm.ts`, with resolution in `effective-agent-config.ts` and the catalog in `llm-catalog.ts`.\n\nGoal: GET /api/llm/config and /api/llm/catalog answer every question the new page asks."
acceptanceCriteria:
  - "The page can be built from GET /api/llm/config, GET /api/llm/catalog and POST /api/llm/config/preview alone."
  - "No route returns a credential value."
plannedRelease: "0.10.0"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
---
