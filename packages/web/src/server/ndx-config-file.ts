/**
 * The shared, git-tracked project config file, read and written whole by the
 * settings routes that edit one section of it.
 *
 * This is the file alone: the gitignored `.n-dx.local.json` overlay is not
 * merged in. Read it here for anything about to be *written back*, so a write
 * never flattens the local overlay's values into the shared file;
 * `readEffectiveNdxConfig` (effective-agent-config.ts) is the read for
 * anything the user should *see*.
 *
 * @module web/server/ndx-config-file
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveLayout } from "@n-dx/llm-client";

/** The project config, or an empty object when the file is absent or does not parse. */
export function readNdxConfig(projectDir: string): Record<string, unknown> {
  const configPath = resolveLayout(projectDir).configFile;
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Write the project config back whole, preserving every key the caller left in place. */
export function writeNdxConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = resolveLayout(projectDir).configFile;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
