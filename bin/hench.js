#!/usr/bin/env node
// Thin wrapper — delegates to the hench CLI via the same resolution logic as cli.js
import { createRequire } from "module";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dir = dirname(dirname(fileURLToPath(import.meta.url)));
const _require = createRequire(import.meta.url);

let script = join(__dir, "packages/hench/dist/cli/index.js");
if (!existsSync(script)) {
  try { script = _require.resolve("@n-dx/hench/dist/cli/index.js"); } catch {}
}

const child = spawn(process.execPath, [script, ...process.argv.slice(2)], { stdio: "inherit" });
child.on("close", (code) => process.exit(code ?? 1));
