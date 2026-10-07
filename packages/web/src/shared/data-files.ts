/**
 * Data file name constants for sourcevision output.
 *
 * A deliberate mirror of `packages/sourcevision/src/schema/data-files.ts`, not
 * an import of it. The web package reaches sourcevision only through
 * `server/domain-gateway.ts` (`packages/core/gateway-rules.json`), and the
 * viewer is bundled for the browser, so neither layer can import a Node
 * package to get at the constant. Restating it here is the boundary working as
 * designed.
 *
 * Two copies of one fact drift silently, and this pair did: it sat four
 * entries behind for long enough that `classifications.json` — which the
 * viewer genuinely reads — was never mtime-watched, so the dashboard did not
 * live-reload when it changed, and it was missing from `GET /data`. The lists
 * are pinned equal by `tests/integration/cross-package-contracts.test.js`
 * now, which fails if either side gains an entry the other lacks.
 *
 * **Adding a data file means editing both files in the same change.**
 *
 * Placed in a neutral `shared/` directory so neither the server nor the viewer
 * layer owns it.
 */

export const DATA_FILES = {
  manifest: "manifest.json",
  inventory: "inventory.json",
  imports: "imports.json",
  classifications: "classifications.json",
  zones: "zones.json",
  components: "components.json",
  callGraph: "callgraph.json",
  projectProfile: "project-profile.json",
  sdlcProfile: "sdlc-profile.json",
  infrastructure: "infrastructure.json",
} as const;

export const ALL_DATA_FILES = Object.values(DATA_FILES);

export const SUPPLEMENTARY_FILES = ["llms.txt", "CONTEXT.md"] as const;
