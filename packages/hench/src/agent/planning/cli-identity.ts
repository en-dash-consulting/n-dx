/**
 * Project CLI identity for prompt/brief construction.
 *
 * n-dx can be embedded under any binary name; `ndx init` records the
 * detected command as `cli.name` in `.n-dx.json` (see
 * packages/core/cli-identity.js). Hench reads that persisted value so agent
 * prompts and task briefs reference the project's actual CLI command instead
 * of a hardcoded "ndx" — hench cannot import the core resolver across the
 * orchestration/execution tier boundary, so this is a read of the recorded
 * config value only (no bin-field detection).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Fallback command name when no cli.name is configured. */
export const DEFAULT_CLI_NAME = "ndx";

/**
 * Read the resolved CLI command name for a project from `.n-dx.json`.
 * Returns DEFAULT_CLI_NAME when the file or field is missing or malformed.
 */
export function resolveProjectCliName(projectDir: string): string {
  const configPath = join(projectDir, ".n-dx.json");
  if (!existsSync(configPath)) return DEFAULT_CLI_NAME;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      cli?: { name?: unknown };
    };
    const name = config.cli?.name;
    return typeof name === "string" && name.length > 0 ? name : DEFAULT_CLI_NAME;
  } catch {
    return DEFAULT_CLI_NAME;
  }
}
