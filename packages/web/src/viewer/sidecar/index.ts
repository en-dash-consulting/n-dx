/**
 * The Sidecar surface the hub session page mounts: the drawer and the hooks it
 * runs on. A narrow barrel beside the full `hooks/` and `components/` barrels,
 * so `hub-session.ts` stays a drawer-sized bundle instead of carrying the whole
 * dashboard. See `hooks/sidecar.ts` for why.
 *
 * @module viewer/sidecar
 */

export * from "../hooks/sidecar.js";
export { HubSessionDrawer } from "../components/hub-session-drawer.js";
