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
  readiness: "readiness.json",
  infrastructure: "infrastructure.json",
  outbound: "outbound.json",
  /** Written only when a language pack produced config reads or flag checks. */
  config: "config.json",
  /** Written only when a language pack produced version floors or legacy-construct uses. */
  legacy: "legacy.json",
  /** Written only when a language pack produced dynamic-code sites. */
  sites: "sites.json",
  /** Written only when a language pack produced declarations (namespaces, named types). */
  declarations: "declarations.json",
} as const;

export const ALL_DATA_FILES = Object.values(DATA_FILES);

export const SUPPLEMENTARY_FILES = ["llms.txt", "CONTEXT.md"] as const;
