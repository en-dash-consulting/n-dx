/**
 * The feature gate is actually on the dispatch path.
 *
 * `tests/unit/server/route-feature-gates.test.ts` proves the gate refuses the
 * right paths for the right flags. It mounts `enforceRouteFeatureGate` itself,
 * so it would pass unchanged if the call in `handleApiRoutes` were deleted —
 * which is the failure mode that matters, because it restores exactly the state
 * this work removed: a toggle that hides a nav entry and nothing else.
 *
 * So this boots the real server and asks it.
 *
 * ## Why a child process
 *
 * `startServer` returns `{ port, isFallback }` and no handle for closing the
 * server, its file watchers, heartbeat monitors or WebSocket intervals. A
 * vitest worker that called it would leak all of them into every later file.
 * The child's exit is the teardown — the same reason and the same driver shape
 * as `scoped-route-dispatch.test.ts`.
 *
 * @see packages/web/src/server/route-feature-gates.ts — the registry under test
 * @see packages/web/tests/integration/scoped-route-dispatch.test.ts — driver pattern
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeTempDir } from "../helpers/temp-dir.js";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";

const execFileAsync = promisify(execFile);

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY = join(WEB_PKG, "dist/server/start.js");
/** A `file://` URL, not a bare path — `C:\...` parses as the scheme `c:`. */
const SERVER_ENTRY_URL = pathToFileURL(SERVER_ENTRY).href;

/** One endpoint per gated toggle. */
const PROBES: ReadonlyArray<[path: string, feature: string]> = [
  ["/api/rex/capture-ask", "sourcevision.ask"],
  ["/api/sv/pr-markdown", "sourcevision.prMarkdown"],
  ["/api/notion/config", "rex.notionSync"],
  ["/api/integrations", "rex.integrations"],
];

interface Probe {
  path: string;
  status: number;
  body: string;
}

/** Boot the real server, GET each probe path, report, exit. */
function driverScript(projectDir: string, paths: readonly string[]): string {
  return `
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};

const { port } = await startServer(${JSON.stringify(projectDir)}, 0, {});

const out = [];
for (const path of ${JSON.stringify(paths)}) {
  const res = await fetch(\`http://127.0.0.1:\${port}\${path}\`);
  out.push({ path, status: res.status, body: await res.text() });
}

console.log("NDX_PROBES=" + JSON.stringify(out));
// Let the watchers and WS intervals the server started settle before the
// hard exit. Without it, libuv on Windows aborts closing a handle that is
// already closing, and the driver dies after printing a perfectly good
// answer — see the exit-code note in probe().
await new Promise((r) => setTimeout(r, 500));
process.exit(0);
`;
}

/** Boot once against a fixture whose toggles are `features`, probe every path. */
async function probe(features: Record<string, boolean>): Promise<Probe[]> {
  const dir = await mkdtemp(join(tmpdir(), "ndx-feature-gate-"));
  try {
    const nested: Record<string, Record<string, boolean>> = {};
    for (const [key, value] of Object.entries(features)) {
      const [pkg, name] = key.split(".");
      nested[pkg] ??= {};
      nested[pkg][name] = value;
    }
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ features: nested }, null, 2), "utf-8");

    const scriptPath = join(dir, "driver.mjs");
    await writeFile(scriptPath, driverScript(dir, PROBES.map(([p]) => p)), "utf-8");

    // The exit code is deliberately not asserted. The child prints its answer
    // and then tears down a server full of fs watchers and intervals it has no
    // handle for; on Windows that teardown can abort inside libuv *after* the
    // line below was written. Whether the process exited cleanly is
    // `scoped-route-dispatch.test.ts`'s subject, not this file's — here the
    // probe line either exists or the failure says so.
    let stdout = "";
    try {
      stdout = (await execFileAsync(process.execPath, [scriptPath], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      })).stdout;
    } catch (err) {
      stdout = (err as { stdout?: string }).stdout ?? "";
    }

    const match = /NDX_PROBES=(.*)/.exec(stdout);
    if (!match) throw new Error(`driver produced no probe line. stdout:\n${stdout}`);
    return JSON.parse(match[1]) as Probe[];
  } finally {
    await removeTempDir(dir);
  }
}

describe("feature gate enforcement through the real dispatcher", () => {
  beforeAll(() => {
    assertFreshServerBuild();
  });

  it("refuses every gated endpoint, naming its flag, when the flags are off", async () => {
    const probes = await probe({});

    for (const [path, feature] of PROBES) {
      const result = probes.find((p) => p.path === path);
      expect(result, `driver never probed ${path}`).toBeDefined();
      expect(
        result!.status,
        `${path} answered ${result!.status}, so the gate for ${feature} is not on the dispatch path`,
      ).toBe(403);
      expect(result!.body).toContain(feature);
    }
  }, 90_000);

  it("stops refusing once the flags are on", async () => {
    const probes = await probe(Object.fromEntries(PROBES.map(([, f]) => [f, true])));

    for (const [path] of PROBES) {
      const result = probes.find((p) => p.path === path);
      // Not 200: the fixture has no .rex/ or .sourcevision/, so these answer
      // 404 or an empty-state body. The assertion is only that the gate is no
      // longer what answers.
      expect(result!.status, `${path} was still refused with the flag on`).not.toBe(403);
    }
  }, 90_000);
});
