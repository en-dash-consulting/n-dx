# Legacy PRD Migration Check Wiring Audit

This document tracks the wiring of `ensureLegacyPrdMigrated()` into all PRD-touching entry points.
Updated: 2026-04-30

## Checklist: Entry Points

### Rex CLI Commands (packages/rex/src/cli/commands/)
- [ ] status.ts - reads PRD
- [ ] next.ts - reads PRD
- [ ] add.ts - writes PRD
- [ ] update.ts - writes PRD
- [ ] move.ts - writes PRD
- [ ] remove.ts - writes PRD
- [ ] validate.ts - reads PRD
- [ ] analyze.ts - reads/writes PRD
- [ ] recommend.ts - reads/writes PRD
- [ ] reorganize.ts - writes PRD
- [ ] reshape.ts - writes PRD
- [ ] prune.ts - writes PRD
- [ ] health.ts - reads PRD
- [ ] verify.ts - reads PRD
- [ ] usage.ts - reads PRD
- [ ] report.ts - reads PRD
- [ ] fix.ts - writes PRD
- [ ] sync.ts - reads/writes PRD
- [ ] smart-add.ts - writes PRD
- [ ] adapter.ts - reads/writes PRD

### Rex MCP Server
- [ ] createRexMcpServer in packages/rex/src/cli/mcp.ts - server startup

### MCP Write Tools (in mcp-tools.ts)
- [ ] handleAddItem
- [ ] handleEditItem
- [ ] handleUpdateTaskStatus
- [ ] handleMergeItems
- [ ] handleMoveItem

### MCP Read Tools (in mcp-tools.ts)
- [ ] handleGetPrdStatus
- [ ] handleGetNextTask
- [ ] handleGetItem
- [ ] handleGetRecommendations
- [ ] handleReorganize
- [ ] handleHealth
- [ ] handleFacets
- [ ] handleVerifyCriteria
- [ ] handleGetTokenUsage

### Web Server (packages/web/src/server/)
- [ ] startServer in start.ts - server startup

### Hench (packages/hench/src/)
- [ ] PRD reads in agent loop

### ndx Orchestrator
- [ ] Covered by rex CLI wiring (via spawn)

## Implementation Notes

**Strategy**: Call `ensureLegacyPrdMigrated(dir)` at the earliest entry point of each command/handler before any PRD read/write operations.

**Key files modified**:
- packages/rex/src/cli/commands/*.ts - added calls
- packages/rex/src/cli/mcp.ts - called in createRexMcpServer
- packages/rex/src/cli/mcp-tools.ts - called in write tool handlers
- packages/web/src/server/start.ts - called in startServer
- packages/hench/src/prd/ops.ts or similar - called before PRD access

**Notification strategy**: 
- Migration check is silent when no migration needed (skipped reason codes)
- On successful migration, emit a clear message to stderr/console
- On error, throw with helpful suggestion text
