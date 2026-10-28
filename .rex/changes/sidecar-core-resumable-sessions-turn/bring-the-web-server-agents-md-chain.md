---
id: "273928bb-8ac9-4b7a-acc7-79e568fb3995"
type: "task"
title: "Bring the web server AGENTS.md chain back under Codex's project-doc budget"
slug: "bring-the-web-server-agents-md-chain"
description: "Task 5845d911 added a four-line bullet about the Sidecar broker key to packages/web/src/server/AGENTS.md. With packages/web/AGENTS.md and the root file, that chain is now 30899 bytes, 179 over the 30720-byte budget, so tests/e2e/agents-md-size-budget.test.js fails. Shorten the bullet to a one-line rule that links to docs/architecture/web-server.md, and move the detail there (the per-session broker key in sidecar/broker-credential.ts is accepted only on a POST to that session's /api/sidecar/sessions/<id>/mcp, and the session can read its MCP config file, so the file never carries the dashboard token). Do not raise the budget."
acceptanceCriteria:
  - "tests/e2e/agents-md-size-budget.test.js passes"
  - "packages/web/src/server/AGENTS.md keeps a one-line rule for the Sidecar broker key that links to docs/architecture/web-server.md, which holds the detail"
  - "tests/e2e/instruction-alignment.test.js passes"
priority: "high"
source: "ndx-capture"
---
