/**
 * The door's handshake, named once for both ends: `dev/ndx-door.ts` (the
 * Vite plugin, in Node) writes a per-launch key into the page, and
 * `ndx-system.ts` (in the browser, which cannot import the plugin) sends it
 * back on every call to the door.
 */

/** The meta tag the door writes its key into. */
export const DOOR_KEY_META = "ndx-door";

/** The header a page sends the door's key in. */
export const DOOR_KEY_HEADER = "x-ndx-door";
