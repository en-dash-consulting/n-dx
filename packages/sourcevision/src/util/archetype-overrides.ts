/**
 * Archetype override persistence.
 *
 * Overrides live in the project's `.n-dx.json` under
 * `sourcevision.archetypes.overrides` (path → archetype id) and are applied
 * by the next `sourcevision analyze` run. Consumed by the MCP
 * `set_file_archetype` tool and, via the public API, by the web dashboard's
 * archetype override control.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function setArchetypeOverride(absDir: string, path: string, archetype: string): void {
  const configPath = join(absDir, ".n-dx.json");
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // Start fresh if corrupted
    }
  }

  if (!config.sourcevision) config.sourcevision = {};
  const sv = config.sourcevision as Record<string, unknown>;
  if (!sv.archetypes) sv.archetypes = {};
  const archetypes = sv.archetypes as Record<string, unknown>;
  if (!archetypes.overrides) archetypes.overrides = {};
  const overrides = archetypes.overrides as Record<string, string>;
  overrides[path] = archetype;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
