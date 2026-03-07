/**
 * Data file name constants for sourcevision output.
 *
 * Shared between the server layer (which serves these files) and the
 * viewer layer (which fetches/validates them). Deliberately placed in
 * a neutral `shared/` directory so neither layer owns the constants.
 */

export const DATA_FILES = {
  manifest: "manifest.json",
  inventory: "inventory.json",
  imports: "imports.json",
  zones: "zones.json",
  components: "components.json",
  callGraph: "callgraph.json",
} as const;

export const ALL_DATA_FILES = Object.values(DATA_FILES);

export const SUPPLEMENTARY_FILES = ["llms.txt", "CONTEXT.md"] as const;
