export const DATA_FILES = {
  manifest: "manifest.json",
  inventory: "inventory.json",
  imports: "imports.json",
  zones: "zones.json",
  components: "components.json",
} as const;

export const ALL_DATA_FILES = Object.values(DATA_FILES);

export const SUPPLEMENTARY_FILES = ["llms.txt", "CONTEXT.md"] as const;
