---
id: "2c7d8e17-2fe7-4352-bfe5-2df086c54e3c"
level: "task"
title: "Serve and save the review settings, with a pairSupported flag, through /api/llm/config"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
blockedBy:
  - "d2d48473-3e07-4ec5-b167-6ba0bd370be2"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "GET returns the review block with sources; with llm.vendor google it reports available false with a reason."
  - "PUT saves the four keys; a reviewer equal to llm.vendor, a google reviewer, and rounds 0 are each rejected with a message."
  - "`pairSupported` is false."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Add `review` to `GET /api/llm/config`:\n\n```\n{ mode, vendor, rounds,\n  models: { claude?: {model, source}, codex?: {model, source} },\n  available: boolean, unavailableReason?: string,\n  pairSupported: false }\n```\n\n- `mode`, `vendor` and `rounds` come from the `hench.review.*` settings, each with its source.\n- `models` is each CLI vendor's reviewer model: `llm.<vendor>.reviewModel`, then `llm.reviewModel`, then the vendor default.\n- `available` is false when the effective provider is the API or the vendor has no CLI, because review needs a CLI on both sides. `unavailableReason` is a sentence the page shows.\n- `pairSupported` is a constant false until pair review lands (PR 8 flips it).\n\nLet `PUT /api/llm/config` save `hench.review.mode`, `hench.review.vendor`, `hench.review.rounds` and `llm.<vendor>.reviewModel`, with the same validation as `ndx config`: the reviewer must be claude or codex and not the active vendor, and rounds must be 1-3."
lastModified: "2026-10-10T23:40:36.217Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
