---
id: "61314ed5-2912-4595-9fb2-f373268fcced"
type: "task"
title: "Your tooling is marked requiresServer"
slug: "your-tooling-is-marked-requiresserver"
description: "Stack review finding on #966 at packages/web/src/viewer/views/stages.ts:264 (review comment 4488637697).\n\n**Should fix: Your tooling isn't marked `requiresServer`, so every static export shows an error**\n\nThe tile reads `/api/llm/config`, `/api/llm/catalog` and `POST /api/commands/auth`, and `packages/core/export.js` writes none of them. In deployed mode `/api/llm/config` maps to `api/llm/config.json`, which 404s, so `getJson` returns null and every exported dashboard's Tune page reads \"Could not read the project's LLM configuration.\" The other server-only tiles (`flow`, `product-map`, `changes-glance`, `ask`) set `requiresServer: true`. Add it here. The flag is still missing at S8."
acceptanceCriteria:
  - "The Your tooling tile is marked requiresServer like the other server-only tiles"
  - "A static export shows no error tile on Tune, with a test like the other server-only tiles'"
---
