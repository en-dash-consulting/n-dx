/**
 * Delegate `sourcevision serve` to the @n-dx/web package.
 *
 * The web server code now lives in packages/web. This stub provides
 * backward compatibility for `sourcevision serve [dir]`.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startServe(dir: string, port: number = 3117): void {
  const webCli = resolve(__dirname, "../../../web/dist/cli/index.js");
  const child = spawn(
    process.execPath,
    [webCli, "serve", "--scope=sourcevision", `--port=${port}`, dir],
    { stdio: "inherit" },
  );
  child.on("close", (code) => process.exit(code ?? 1));
}
