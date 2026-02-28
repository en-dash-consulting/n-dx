/**
 * Shared UI re-exports for web-shared-utilities zone.
 *
 * Views and components in the web-shared-utilities zone (prd.ts, analysis.ts,
 * task-detail.ts, …) need a handful of shared artifacts from the larger
 * web-mcp-server zone (logos, types, copy-link-button).  Routing all of those
 * cross-zone imports through this single barrel:
 *
 * - makes the dependency surface **explicit** (one file, not scattered imports)
 * - prevents bidirectional coupling from growing silently
 * - mirrors the gateway pattern used in the rest of the monorepo
 *
 * Add new cross-zone imports here rather than importing from the source
 * modules directly in leaf files.
 */

export { BrandedHeader } from "../logos.js";
export type { DetailItem, NavigateTo } from "../../types.js";
export { CopyLinkButton, buildShareableUrl } from "../copy-link-button.js";
