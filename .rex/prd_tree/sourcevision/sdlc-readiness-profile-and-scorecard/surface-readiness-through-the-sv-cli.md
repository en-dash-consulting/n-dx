---
id: "e29bdb3e-0108-4374-b95b-cc73976b7556"
level: "task"
title: "Surface readiness through the sv CLI, ndx passthrough, MCP and the sv status"
status: "pending"
priority: "medium"
blockedBy:
  - "e6649d84-5c5d-4e48-8a83-7ea8a37dc110"
source: "ndx-capture"
acceptanceCriteria:
  - "`sourcevision readiness` runs and prints the scorecard; `--json` prints the machine-readable artifact; help is registered in `cli/help.ts` and appears in `sourcevision --help`."
  - "`ndx readiness` is registered in `COMMAND_DISPATCH` in `packages/core/cli.js` as a spawn, matching the existing delegate pattern; `packages/core` gains no imports and `tests/e2e/architecture-policy.test.js` passes."
  - "`get_readiness` is exposed on the SourceVision MCP server in `cli/mcp.ts` and returns the same artifact the CLI prints."
  - "Readiness types reach web only as re-exports through `packages/web/src/server/domain-gateway.ts`, with no logic added; `tests/e2e/domain-isolation.test.js` passes."
  - "`readiness: { overall, analyzedAt }` appears in the sv section of the status response in `packages/web/src/server/routes-status.ts`, and is absent or null rather than throwing when no readiness artifact exists."
  - "No dashboard view is added."
  - "One e2e test proves `sv analyze` writes `sdlc-profile.json`."
  - "`docs/packages/sourcevision.md` and `docs/guide/commands.md` document the command and artifacts, label the scorecard as heuristic, and list every detector in a table."
  - "A changeset exists with patch bumps for `@n-dx/sourcevision`, `@n-dx/core` and `@n-dx/web`."
description: "Four surfaces, each following its tier's existing pattern:\n\n- `sourcevision readiness [--json]` as a CLI command under `cli/commands/`, with help registered in `cli/help.ts`.\n- `ndx readiness` in `COMMAND_DISPATCH` in `packages/core/cli.js`, following the existing delegate pattern — orchestration spawns, it never imports.\n- `get_readiness` as an MCP tool in `cli/mcp.ts`, returning the same artifact the CLI prints.\n- Types re-exported through `packages/web/src/server/domain-gateway.ts` only, with no logic there, plus `readiness: { overall, analyzedAt }` on the sv status in `packages/web/src/server/routes-status.ts` so the hub card can show it later.\n\nA dashboard view is out of scope — the status field exists so the view can be built later without touching this work again. Docs for the command and the artifacts go in `docs/packages/sourcevision.md` and `docs/guide/commands.md`, marking the scorecard as heuristic and listing every detector in a table."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-06T22:01:02.234Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
