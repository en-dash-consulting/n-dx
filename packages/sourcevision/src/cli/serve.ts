/**
 * Delegate `sourcevision serve` to the @n-dx/web package.
 *
 * The web server code now lives in packages/web. This stub provides
 * backward compatibility for `sourcevision serve [dir]`.
 *
 * Resolution uses the pnpm workspace root to locate the sibling package,
 * avoiding a hardcoded relative path that would create a tier-inversion
 * edge in the import graph (Domain → Web).
 */

import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnTool } from "@n-dx/llm-client";

const __filename = fileURLToPath(import.meta.url);

/**
 * Walk up from the current file to find the monorepo root
 * (identified by pnpm-workspace.yaml), then resolve the web CLI.
 */
function resolveWebCli(): string {
  let dir = dirname(__filename);
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      const webCli = resolve(dir, "packages/web/dist/cli/index.js");
      if (existsSync(webCli)) return webCli;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate @n-dx/web CLI. Ensure you are running inside the n-dx workspace.",
  );
}

export async function startServe(dir: string, port: number = 3117): Promise<void> {
  const webCli = resolveWebCli();
  const result = await spawnTool(
    process.execPath,
    [webCli, "serve", "--scope=sourcevision", `--port=${port}`, dir],
  );
  process.exit(result.exitCode ?? 1);
}
