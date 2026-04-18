<!-- Sourcevision Hints -->
This is a monorepo containing an AI-powered development toolkit (n-dx).
The web package has a clear server/viewer boundary that should be preserved as separate zones.

## Zone structure guidance

### packages/web/src/server/ — web-server zone
`packages/web/src/server/` is the **HTTP server composition root** — it wires Express routes,
gateways, and MCP handlers. This zone naturally has high coupling (it imports from rex, sourcevision,
and shared utilities by design) and low cohesion (route handlers are independent by design).
The high coupling is architecturally correct for a composition root; do not flag it as a defect.
Prefer naming the zone "web-server" or "Web Server" and treating it as a distinct zone from the viewer.

### packages/web/src/shared/ — web-shared zone
`packages/web/src/shared/` is the **framework-agnostic foundation layer** — it contains shared
constants, type definitions, and routing helpers consumed by both server and viewer. This should
be its own zone ("web-shared" or "Web Shared"), separate from viewer components.

### packages/web/src/viewer/ — web-viewer zone
`packages/web/src/viewer/` contains Preact UI components, hooks, and views.
`packages/web/src/viewer/messaging/` is the messaging middleware sub-zone.

### packages/hench/src/agent/lifecycle/token-usage.ts — hench-token-usage zone
Token usage parsing, aggregation, and formatting for the hench agent lifecycle.
Prefer naming this zone "hench-token-usage" or "Hench Token Usage" — it is a focused
utility module separate from the broader hench agent zone.

### packages/rex/tests/ — rex-unit zone
Rex CLI command unit tests and shared test support helpers.
Prefer naming this zone "rex-unit" or "Rex Unit Tests" — Louvain may emit "rex-2" as an overflow
community name; the files are pinned to "rex-unit" in .n-dx.json and should not be renamed back.
Files: rex-dir-test-support.ts, fix.test.ts, next-colors.test.ts, usage.test.ts.

### packages/web/tests/unit/viewer/ — web-sv-view-tests zone
SourceVision viewer unit tests (enrichment-thresholds.test.ts, sourcevision-tabs.test.ts).
Prefer naming this zone "web-sv-view-tests" — Louvain may emit "web-3" as an overflow community
name; the test files are pinned to "web-sv-view-tests" in .n-dx.json with zone type "test".
The corresponding source files (enrichment-thresholds.ts, sourcevision-tabs.ts, views/index.ts)
are pinned to "web-viewer".

### Expected zone separation
- web-server (packages/web/src/server/): composition root, 30+ files
- web-shared (packages/web/src/shared/): foundation utilities, 5 files
- web-viewer (packages/web/src/viewer/): Preact UI, 100+ files
- viewer-message-pipeline (packages/web/src/viewer/messaging/): messaging middleware
- hench-token-usage (packages/hench/src/agent/lifecycle/token-usage.ts): token usage utilities
- rex-unit (packages/rex/tests/unit/cli/commands/ + tests/helpers/): rex CLI unit tests + test support
- web-sv-view-tests (packages/web/tests/unit/viewer/enrichment-thresholds.test.ts + sourcevision-tabs.test.ts): SourceVision viewer unit tests
