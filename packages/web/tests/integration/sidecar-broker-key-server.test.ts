/**
 * The production dashboard server, with a token, accepts a Sidecar session's
 * broker key on that session's `POST …/mcp` and refuses it everywhere else.
 *
 * `sidecar-broker-credential.test.ts` builds its own gate-plus-routes handler,
 * so nothing there fails if `createHttpServer` in start.ts stops passing
 * `scopedCredential: isSidecarBrokerRequest` to the request gate (or passes
 * `{ token }` alone). Then every broker call from a Sidecar CLI answers 401:
 * the session has no broker tools and no card is ever raised.
 *
 * The server runs in a child process, as in `feature-gate-enforcement.test.ts`:
 * `startServer` returns no handle to close it. The child imports the built
 * credential module by the same file URL the server does, so the key it mints
 * is the one the server's gate checks.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { removeTempDir } from "../helpers/temp-dir.js";

const execFileAsync = promisify(execFile);

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY_URL = pathToFileURL(join(WEB_PKG, "dist/server/start.js")).href;
const CREDENTIAL_URL = pathToFileURL(join(WEB_PKG, "dist/server/sidecar/broker-credential.js")).href;

const SESSION = "unknown-id";

interface Answer {
  label: string;
  status: number;
}

function driverScript(projectDir: string, tokenFile: string): string {
  return `
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};
import { sidecarBrokerCredential, SIDECAR_BROKER_KEY_HEADER } from ${JSON.stringify(CREDENTIAL_URL)};

const { port } = await startServer(${JSON.stringify(projectDir)}, 0, { tokenFile: ${JSON.stringify(tokenFile)} });
const base = \`http://127.0.0.1:\${port}\`;
const key = { [SIDECAR_BROKER_KEY_HEADER]: sidecarBrokerCredential(${JSON.stringify(SESSION)}) };
const mcp = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const tools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

const out = [];
async function ask(label, path, init) {
  const res = await fetch(base + path, init);
  await res.text();
  out.push({ label, status: res.status });
}
await ask("key on broker route", "/api/sidecar/sessions/${SESSION}/mcp", { method: "POST", headers: { ...key, ...mcp }, body: tools });
await ask("key on session list", "/api/sidecar/sessions", { headers: key });
await ask("no credential on broker route", "/api/sidecar/sessions/${SESSION}/mcp", { method: "POST", headers: mcp, body: tools });

console.log("NDX_ANSWERS=" + JSON.stringify(out));
await new Promise((r) => setTimeout(r, 500));
process.exit(0);
`;
}

async function probe(): Promise<Answer[]> {
  const dir = await mkdtemp(join(tmpdir(), "ndx-sidecar-key-"));
  try {
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar: true } } }), "utf-8");
    const scriptPath = join(dir, "driver.mjs");
    await writeFile(scriptPath, driverScript(dir, join(dir, "auth.token")), "utf-8");

    // The exit code is not asserted: tearing down a server with no close handle
    // can abort in libuv on Windows after the answer line is written.
    let stdout = "";
    try {
      stdout = (await execFileAsync(process.execPath, [scriptPath], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 })).stdout;
    } catch (err) {
      stdout = (err as { stdout?: string }).stdout ?? "";
    }
    const match = /NDX_ANSWERS=(.*)/.exec(stdout);
    if (!match) throw new Error(`driver produced no answer line. stdout:\n${stdout}`);
    return JSON.parse(match[1]) as Answer[];
  } finally {
    await removeTempDir(dir);
  }
}

describe("the dashboard server's request gate and a Sidecar broker key", () => {
  beforeAll(() => {
    assertFreshServerBuild();
  });

  it("accepts the key on its session's broker route only", async () => {
    const answers = await probe();
    const status = (label: string) => answers.find((a) => a.label === label)?.status;

    // An unknown session answers 404 past the gate; 401 means the gate refused.
    expect(status("key on broker route")).not.toBe(401);
    expect(status("key on broker route")).toBeDefined();
    expect(status("key on session list")).toBe(401);
    expect(status("no credential on broker route")).toBe(401);
  }, 90_000);
});
