---
id: "3266bfb4-aea5-4a97-b717-211bd55d55a6"
level: "task"
title: "Stop GET /api/ndx-config from writing .n-dx.json"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "request-hardening"
  - "web"
source: "0.8.0 request hardening (2026-10-01)"
startedAt: "2026-10-09T04:38:14.513Z"
completedAt: "2026-10-09T04:38:14.513Z"
endedAt: "2026-10-09T04:38:14.513Z"
acceptanceCriteria:
  - "GET /api/ndx-config never modifies .n-dx.json, including when the local vendor reports a different live model (test asserts the file's content and mtime are unchanged)."
  - "The response still reports the live model when it differs from the configured one."
  - "The operator can still save the live model through an explicit write, and a test covers that write."
  - "A .changeset file bumps @n-dx/web as patch."
description: "`extractConfig` in `packages/web/src/server/routes-config.ts`, which answers GET /api/ndx-config, persists the live model name back into `.n-dx.json` when the vendor is `local` and LM Studio reports a different model than the one configured. A read-only route must not write project files. Keep reporting the live model in the GET response, and move the persistence to an explicit write: either the existing config write path the settings pages use, or a POST that the Robot Wrangler page calls when it shows the operator that the live model differs.\n\nConstraints: as for every n-dx change (gateways, changeset with scoped package name, patch bump, pnpm preflight)."
lastModified: "2026-10-09T04:38:14.999Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
