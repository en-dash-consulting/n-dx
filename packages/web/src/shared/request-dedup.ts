/**
 * Re-export from canonical location in the messaging zone.
 *
 * `request-dedup` was moved to `src/viewer/messaging/request-dedup.ts` to
 * resolve a dependency inversion: the messaging pipeline (a utility zone)
 * was importing from the web-dashboard zone (its consumer). Moving the
 * module into the messaging zone eliminates the cross-zone edge and keeps
 * the dependency direction correct (consumer → utility).
 *
 * This re-export preserves backward compatibility for any transitive
 * consumers of `src/shared/index.ts`.
 */
export { createRequestDedup } from "../viewer/messaging/request-dedup.js";
export type { RequestDedup } from "../viewer/messaging/request-dedup.js";
