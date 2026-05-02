---
id: "4c11effd-e8a0-43ed-a09f-7662c5d874a8"
level: "task"
title: "Address relationship issues (6 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T05:00:56.419Z"
completedAt: "2026-03-08T05:12:26.786Z"
acceptanceCriteria: []
description: "- cli-e2e-tests validates CLI delegation but has no direct coverage of the MCP transport layer (HTTP session management, Streamable HTTP protocol) — MCP regressions could pass all e2e tests yet break Claude Code integration.\n- Hench is the sole writer to .rex/execution-log.jsonl and a co-writer to .rex/prd.json alongside rex itself — two independent writers sharing a mutable JSON file without a locking protocol is a latent data-corruption risk if hench and rex CLI commands are ever run concurrently (e.g. in CI).\n- Rex MCP routing (routes-rex.ts) lives inside web-dashboard rather than mcp-route-layer, splitting MCP protocol handling across two zones — moving routes-rex.ts into mcp-route-layer would unify the MCP boundary and reduce web-dashboard's surface area.\n- monorepo-maintenance-scripts enforces gateway discipline for hench and web but has no equivalent check for the rex or sourcevision packages, leaving those gateways unguarded by static script validation.\n- The orchestration zone has no import edges to any other zone, meaning integration contract violations (e.g. changed CLI flags or output formats in rex/sourcevision/hench) will only manifest at runtime, not at build or typecheck time — consider adding a contract-test layer in e2e that validates CLI I/O contracts across package boundaries.\n- Rex-runtime-state is a shared mutable filesystem interface consumed by rex (writer), hench (reader/writer via rex-gateway), and web-server (reader via MCP) — this hidden fan-in dependency is invisible to import-graph tooling and creates a schema coupling risk across three tiers of the hierarchy."
recommendationMeta: "[object Object]"
---

# Address relationship issues (6 findings)

🟠 [completed]

## Summary

- cli-e2e-tests validates CLI delegation but has no direct coverage of the MCP transport layer (HTTP session management, Streamable HTTP protocol) — MCP regressions could pass all e2e tests yet break Claude Code integration.
- Hench is the sole writer to .rex/execution-log.jsonl and a co-writer to .rex/prd.json alongside rex itself — two independent writers sharing a mutable JSON file without a locking protocol is a latent data-corruption risk if hench and rex CLI commands are ever run concurrently (e.g. in CI).
- Rex MCP routing (routes-rex.ts) lives inside web-dashboard rather than mcp-route-layer, splitting MCP protocol handling across two zones — moving routes-rex.ts into mcp-route-layer would unify the MCP boundary and reduce web-dashboard's surface area.
- monorepo-maintenance-scripts enforces gateway discipline for hench and web but has no equivalent check for the rex or sourcevision packages, leaving those gateways unguarded by static script validation.
- The orchestration zone has no import edges to any other zone, meaning integration contract violations (e.g. changed CLI flags or output formats in rex/sourcevision/hench) will only manifest at runtime, not at build or typecheck time — consider adding a contract-test layer in e2e that validates CLI I/O contracts across package boundaries.
- Rex-runtime-state is a shared mutable filesystem interface consumed by rex (writer), hench (reader/writer via rex-gateway), and web-server (reader via MCP) — this hidden fan-in dependency is invisible to import-graph tooling and creates a schema coupling risk across three tiers of the hierarchy.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-08T05:00:56.419Z
- **Completed:** 2026-03-08T05:12:26.786Z
- **Duration:** 11m
