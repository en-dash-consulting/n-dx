/**
 * Resolved CLI name lookup for server routes.
 *
 * The project's installed command name is recorded as `cli.name` in
 * `.n-dx.json` by `ndx init` (see packages/core/cli-identity.js). Routes
 * that render or return CLI invocations read it through this helper so the
 * dashboard reflects the project's actual command (e.g. `myapp plan`).
 */

import { readFileSync } from "node:fs";
import { resolveLayout } from "@n-dx/llm-client";

/** Fallback command name when no cli.name is configured. */
export const DEFAULT_CLI_NAME = "n-dx";

/** Read the resolved CLI command name (`cli.name` in the project config, default n-dx). */
export function readCliName(projectDir: string): string {
  try {
    const raw = readFileSync(resolveLayout(projectDir).configFile, "utf-8");
    const config = JSON.parse(raw) as { cli?: { name?: unknown } };
    const name = config.cli?.name;
    return typeof name === "string" && name.length > 0 ? name : DEFAULT_CLI_NAME;
  } catch {
    return DEFAULT_CLI_NAME;
  }
}
