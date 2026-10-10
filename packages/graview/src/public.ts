/**
 * Public API for the graview package.
 *
 * ## API philosophy: a projection, as functions + types
 *
 * `@n-dx/graview` is consumed two ways: core spawns its CLI (`ndx graview
 * <sub>`), and a host that wants the projection in-process (the dashboard,
 * a test) calls `buildSnapshot` or `emitProjection`. This surface exports
 * those, the declaration as data, the mapping tables a drift test holds the
 * declaration to, and the binary resolution, so nothing outside this package
 * needs to know where the files land or which graview release is pinned.
 *
 * ## Architectural isolation
 *
 * Coordination level, beside web: imports `@n-dx/rex` and `@n-dx/sourcevision`
 * and `@n-dx/hench` at runtime, each through its own gateway. No
 * `@graview/*` dependency: the graview binary is a peer tool. Nothing imports
 * this package but core's CLI.
 *
 * ## Configuration
 *
 * The `graview` section of the project config (`bin`, `includeFiles`, `app`) is read
 * by `readGraviewConfig`; there is no default-config factory, because every
 * key is optional and the defaults are the resolver's.
 *
 * @module graview/public
 */
export { buildSnapshot, graviewDirOf } from "./snapshot.js";
export type { BuildSnapshotOptions, SnapshotReport } from "./snapshot.js";
export { emitProjection, DOCUMENT_FILENAME, SNAPSHOT_FILENAME, DATA_DIRNAME } from "./emit.js";
export type { EmitOptions, EmitResult } from "./emit.js";
export { loadDocument, documentFor, declaredEdges, NODE_KINDS, PRODUCT_EDGE_SOURCES, DOCUMENT_PATH, GRAVIEW_VERSION } from "./document.js";
export type { GraviewDocumentData, DocumentKind, DocumentField, DocumentEdge, DocumentLens, DocumentRule } from "./document.js";
export { resolveGraviewCommand, readGraviewConfig, GRAVIEW_BIN_ENV } from "./graview-bin.js";
export type { GraviewCommand, GraviewBinSource, GraviewConfig, ResolveGraviewOptions } from "./graview-bin.js";
export { canonicalJson } from "./canonical.js";
export { rexMcpEndpoint, hubPort, DEFAULT_HUB_PORT } from "./hub.js";
export type { RexEndpoint } from "./hub.js";
export type { GraphSnapshot, SnapshotNode, SnapshotEdge } from "./types.js";
export { releaseId, RELEASE_PREFIX } from "./sources/requirements.js";
export { COMPONENT_PREFIX, FILE_PREFIX } from "./sources/code.js";
