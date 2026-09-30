/**
 * Archetype override persistence.
 *
 * Overrides live in the project's `.n-dx.json` under
 * `sourcevision.archetypes.overrides` (path → archetype id) and are applied
 * by the next `sourcevision analyze` run. Consumed by the MCP
 * `set_file_archetype` tool and, via the public API, by the web dashboard's
 * archetype override control.
 *
 * The file is located through the layout resolver: on a project with `.ndx/`
 * it is `.ndx/config.json`. Writing the legacy name there would create a
 * second config file that nothing reads, so every override set from the
 * dashboard would appear to save and then vanish.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolveLayout } from "@n-dx/llm-client";

export function setArchetypeOverride(absDir: string, path: string, archetype: string): void {
  const configPath = resolveLayout(absDir).configFile;
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
