import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const VITEST_BIN = resolve(ROOT_DIR, "node_modules/vitest/vitest.mjs");

async function canBindLoopback() {
  return await new Promise((resolvePromise) => {
    const server = createServer();
    const finish = (ok) => {
      server.removeAllListeners();
      resolvePromise(ok);
    };

    server.once("error", () => finish(false));
    server.listen(0, "127.0.0.1", () => {
      server.close(() => finish(true));
    });
  });
}

function excludesForProfile(profile) {
  switch (profile) {
    case "root":
      return [
        "tests/e2e/cli-start.test.js",
        "tests/e2e/cli-web.test.js",
        "tests/e2e/mcp-transport.test.js",
      ];
    case "web":
      return [
        "tests/unit/server/**",
        "tests/integration/smart-add-dispatch.test.ts",
        "tests/integration/ws-health-integration.test.ts",
      ];
    case "sourcevision":
      return ["tests/e2e/cli-serve.test.ts"];
    default:
      return [];
  }
}

const profile = process.argv[2] ?? "default";
const passthroughArgs = process.argv.slice(3);
const bindAvailable = await canBindLoopback();

const vitestArgs = ["run", ...passthroughArgs];
if (!bindAvailable) {
  const excludes = excludesForProfile(profile);
  if (excludes.length > 0) {
    console.log(
      `[vitest-bind-aware] local socket bind unavailable; excluding ${profile} network suites.`,
    );
    for (const pattern of excludes) {
      vitestArgs.push("--exclude", pattern);
    }
  }
}

const result = spawnSync(process.execPath, [VITEST_BIN, ...vitestArgs], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
