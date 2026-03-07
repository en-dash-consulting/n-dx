/**
 * SourceVision domain views — barrel module.
 *
 * Groups all SourceVision-specific view components behind a single import
 * boundary. This establishes a natural decomposition point within the
 * web-viewer zone, enabling future extraction or lazy-loading of the
 * entire SourceVision view surface without touching individual files.
 *
 * Domain scope: codebase analysis, import graphs, zones, files, routes,
 * architecture findings, and PR markdown.
 */

export { Overview } from "./overview.js";
export { Graph } from "./graph.js";
export { ZonesView } from "./zones.js";
export { FilesView } from "./files.js";
export { ArchitectureView } from "./architecture.js";
export { ProblemsView } from "./problems.js";
export { SuggestionsView } from "./suggestions.js";
export { PRMarkdownView } from "./pr-markdown.js";
export { RoutesView } from "./routes.js";
export { AnalysisView } from "./analysis.js";
