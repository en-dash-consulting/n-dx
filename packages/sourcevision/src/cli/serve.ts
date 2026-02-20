/**
 * Delegate `sourcevision serve` to the @n-dx/web package.
 *
 * The web server code now lives in packages/web. This stub provides
 * backward compatibility for `sourcevision serve [dir]`.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTool } from "@n-dx/llm-client";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startServe(dir: string, port: number = 3117): Promise<void> {
  const webCli = resolve(__dirname, "../../../web/dist/cli/index.js");
  const result = await spawnTool(
    process.execPath,
    [webCli, "serve", "--scope=sourcevision", `--port=${port}`, dir],
  );
  process.exit(result.exitCode ?? 1);
}
