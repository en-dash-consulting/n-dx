/**
 * The door's handshake and routes, named once for both ends: `dev/ndx-door.ts`
 * (the Vite plugin, in Node) writes a per-launch key into the page and answers
 * the routes, and `ndx-system.ts` and the pages face (in the browser, which
 * cannot import the plugin) send the key back on every call to the door.
 */

/** The meta tag the door writes its key into. */
export const DOOR_KEY_META = "ndx-door";

/** The header a page sends the door's key in. */
export const DOOR_KEY_HEADER = "x-ndx-door";

/** Every door route starts with this, under the face's base path; a call to one carries the key. */
export const DOOR_PATH_PREFIX = "/ndx/";

/** GET: whether rex and a re-emit are behind the door. */
export const DOOR_SYNC_INFO_PATH = `${DOOR_PATH_PREFIX}sync-info`;

/** POST: re-emit the projection when something it reads has changed. */
export const DOOR_EMIT_PATH = `${DOOR_PATH_PREFIX}emit`;

/** POST: rex's MCP tools, behind the key. */
export const DOOR_MCP_PATH = `${DOOR_PATH_PREFIX}mcp`;
