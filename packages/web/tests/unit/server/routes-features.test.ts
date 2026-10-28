/**
 * `PUT /api/features` — the write path into the `features` block of `.n-dx.json`.
 *
 * The registry allowlist is what keeps a prototype-chain key out of the file;
 * the nested write beneath it is the guarded `setConfigValue` from
 * hench-config-fields, so a key that somehow passed the allowlist would still
 * write nothing. Both halves are pinned here.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleFeaturesRoute } from "../../../src/server/routes-features.js";
import {
  startRouteTestServer,
  removeTestDir,
  type RouteTestServer,
} from "../../helpers/server-route-test-support.js";

let projectDir: string;
let server: RouteTestServer;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-features-"));
  server = await startRouteTestServer((req, res) =>
    handleFeaturesRoute(req, res, { projectDir } as never),
  );
});

afterEach(async () => {
  await server.close();
  await removeTestDir(projectDir);
});

function put(changes: Record<string, unknown>): Promise<Response> {
  return fetch(`${server.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

describe("PUT /api/features", () => {
  it("refuses a prototype-chain key as unknown and leaves .n-dx.json unchanged", async () => {
    const configPath = join(projectDir, ".n-dx.json");
    const seed = JSON.stringify({ features: { sourcevision: { callGraph: true } } });
    await writeFile(configPath, seed, "utf-8");

    const res = await put({ "__proto__.polluted": true });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Unknown feature key(s)");
    expect(await readFile(configPath, "utf-8")).toBe(seed);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("writes a registry key as a nested features entry", async () => {
    const res = await put({ "sourcevision.callGraph": true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: [{ key: "sourcevision.callGraph", enabled: true }] });
    const config = JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));
    expect(config.features.sourcevision.callGraph).toBe(true);
  });
});

describe("GET /api/features", () => {
  it("lists rex.placementDraft as an off-by-default rex toggle, and reflects turning it on", async () => {
    const read = async () => {
      const body = await (await fetch(`${server.baseUrl}/api/features`)).json() as { toggles: Array<Record<string, unknown>> };
      return body.toggles.find((t) => t.key === "rex.placementDraft");
    };
    expect(await read()).toMatchObject({ package: "rex", stability: "experimental", defaultValue: false, enabled: false });
    expect((await put({ "rex.placementDraft": true })).status).toBe(200);
    expect(await read()).toMatchObject({ enabled: true });
  });
});
