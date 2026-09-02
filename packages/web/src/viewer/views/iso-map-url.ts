/**
 * Isometric-map URL construction — framework-free helpers.
 *
 * The Isometric Map view drives the server route `GET /api/iso-map`, which
 * accepts three query parameters. Keeping the control-state → URL mapping in
 * its own Preact-free module means the contract with the route can be unit
 * tested without mounting a component, and keeps the mapping in one place so
 * the iframe, the "open in new tab" link and the download link can never drift
 * apart.
 *
 * The bounds mirror `packages/web/src/server/routes-iso-map.ts`. They are
 * duplicated rather than imported because the viewer must not carry a runtime
 * import from `src/server/` (enforced by `tests/integration/boundary-check.test.ts`).
 *
 * @module web/viewer/views/iso-map-url
 */

/** Where the map's model input comes from. Mirrors sourcevision's `IsoSourceMode`. */
export type IsoMapSource = "auto" | "sourcevision" | "scan";

/** Server route backing the map. */
export const ISO_MAP_ENDPOINT = "/api/iso-map";

/**
 * Header the route sets on a 200 that carries no map.
 *
 * "Nothing to map yet" answers 200 rather than 404 because a 4xx on a `fetch`
 * writes a network error into the browser console, and every view has to load
 * with none (`tests/e2e-ui/navigation.spec.ts`). Mirrored from
 * `src/server/routes-iso-map.ts` rather than imported, for the same reason the
 * bounds below are: the viewer must not carry a runtime import from
 * `src/server/`. `routes-iso-map.test.ts` pins the two together.
 */
export const ISO_MAP_EMPTY_HEADER = "x-iso-map-empty";

/** Selectable source modes, in the order they appear in the UI. */
export const ISO_MAP_SOURCES: readonly IsoMapSource[] = ["auto", "sourcevision", "scan"];

/** Human-readable labels for each source mode. */
export const ISO_MAP_SOURCE_LABELS: Readonly<Record<IsoMapSource, string>> = {
  auto: "Auto",
  sourcevision: "SourceVision analysis",
  scan: "Direct scan",
};

/** Lower bound on `maxNodes`, mirroring the route's validation. */
export const ISO_MAP_MIN_NODES = 1;

/** Upper bound on `maxNodes`, mirroring the route's validation. */
export const ISO_MAP_MAX_NODES = 500;

/** Generation options held by the view's controls. */
export interface IsoMapControls {
  source: IsoMapSource;
  maxNodes: number;
  includeExternals: boolean;
}

/** Control state the view starts from — matches the route's own defaults. */
export const ISO_MAP_DEFAULTS: IsoMapControls = {
  source: "auto",
  maxNodes: 40,
  includeExternals: true,
};

/** True when `value` is one of the three accepted source modes. */
export function isIsoMapSource(value: string): value is IsoMapSource {
  return (ISO_MAP_SOURCES as readonly string[]).includes(value);
}

/**
 * Coerce arbitrary input into a valid `maxNodes`.
 *
 * A number input can hand back `NaN` (empty field) or an out-of-range value
 * pasted past the `min`/`max` attributes. Clamping in the viewer keeps the
 * request inside the range the route accepts rather than trading a typo for a
 * 400 the user has to decode.
 */
export function clampMaxNodes(value: number): number {
  if (!Number.isFinite(value)) return ISO_MAP_DEFAULTS.maxNodes;
  const rounded = Math.round(value);
  if (rounded < ISO_MAP_MIN_NODES) return ISO_MAP_MIN_NODES;
  if (rounded > ISO_MAP_MAX_NODES) return ISO_MAP_MAX_NODES;
  return rounded;
}

/**
 * Build the `/api/iso-map` URL for a control state.
 *
 * Every parameter is emitted explicitly, including ones that equal the route
 * default: the URL is also what "Open in new tab" and "Download HTML" hand to
 * the user, and a self-describing query string is far easier to tweak by hand
 * than one that relies on defaults.
 */
export function buildIsoMapUrl(controls: IsoMapControls): string {
  const params = new URLSearchParams({
    source: controls.source,
    maxNodes: String(clampMaxNodes(controls.maxNodes)),
    externals: controls.includeExternals ? "1" : "0",
  });
  return `${ISO_MAP_ENDPOINT}?${params.toString()}`;
}

/**
 * Suggested filename for the "Download HTML" action.
 *
 * Encodes the source mode so several downloads from the same project stay
 * distinguishable in the browser's download list.
 */
export function isoMapDownloadName(controls: IsoMapControls): string {
  return `iso-map-${controls.source}-${clampMaxNodes(controls.maxNodes)}.html`;
}
