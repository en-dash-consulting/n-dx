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

### Expected zone separation
- web-server (packages/web/src/server/): composition root, 30+ files
- web-shared (packages/web/src/shared/): foundation utilities, 5 files
- web-viewer (packages/web/src/viewer/): Preact UI, 100+ files
- viewer-message-pipeline (packages/web/src/viewer/messaging/): messaging middleware
