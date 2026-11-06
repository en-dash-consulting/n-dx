---
id: "5635b3c2-9d02-49e5-b0f9-0e69a43a1383"
type: "task"
title: "ndx init and migrate-layout gitignore the dashboard's usage log and runtime files on the .ndx/ layout"
slug: "ndx-init-and-migrate-layout-gitignore"
description: "The dashboard usage ledger (packages/web/src/server/dashboard-usage.ts:100) writes .ndx/web-usage.jsonl, which ndx init (packages/core/cli.js:1679-1690) and migrate-layout (packages/core/migrate-layout.js:398-399) never gitignore; the template packages/core/assistant-assets/ndx.gitignore:47-51 lists only the legacy .n-dx-web-usage.jsonl/.n-dx-web.pid/.n-dx-web.port spellings. Add the .ndx/ spellings of every machine-local web file to the managed gitignore block in both commands and the template, idempotently. Check docs/architecture/generated-files.md lists them. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "ndx init on the .ndx/ layout gitignores .ndx/web-usage.jsonl and the web pid/port files (core test)"
  - "migrate-layout adds the same entries (core test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
