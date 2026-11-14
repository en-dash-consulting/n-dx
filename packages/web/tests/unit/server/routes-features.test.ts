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

/** Toggles nothing read, removed from the registry on 2026-11-12. */
const REMOVED_KEYS = [
  "sourcevision.callGraph",
  "sourcevision.enrichment",
  "sourcevision.componentCatalog",
  "rex.autoComplete",
  "rex.budgetEnforcement",
  "hench.autoRetry",
  "hench.guardRails",
  "hench.adaptiveWorkflow",
];

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
    const seed = JSON.stringify({ features: { rex: { showTokenBudget: true } } });
    await writeFile(configPath, seed, "utf-8");

    const res = await put({ "__proto__.polluted": true });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Unknown feature key(s)");
    expect(await readFile(configPath, "utf-8")).toBe(seed);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("writes a registry key as a nested features entry", async () => {
    const res = await put({ "rex.showTokenBudget": true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: [{ key: "rex.showTokenBudget", enabled: true }] });
    const config = JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));
    expect(config.features.rex.showTokenBudget).toBe(true);
  });

  it.each(REMOVED_KEYS)("refuses the removed toggle %s as unknown", async (key) => {
    const res = await put({ [key]: true });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Unknown feature key(s)");
  });
});

describe("GET /api/features", () => {
  it("puts every toggle in a Project settings section, and marks the token spenders", async () => {
    const body = await (await fetch(`${server.baseUrl}/api/features`)).json() as { toggles: Array<Record<string, unknown>> };
    const groups = Object.fromEntries(body.toggles.map((t) => [t.key, t.group]));
    expect(groups).toMatchObject({
      "sourcevision.ask": "optional",
      "rex.placementDraft": "optional",
      "hench.runVerdict": "optional",
      "rex.showTokenBudget": "display",
      "git.failForward": "git",
      "git.autoCommitGenerated": "git",
      "web.sidecar": "connections",
    });
    expect(body.toggles.every((t) => typeof t.group === "string")).toBe(true);
    const spenders = body.toggles.filter((t) => t.costsTokens === true).map((t) => t.key).sort();
    expect(spenders).toEqual(["rex.placementDraft", "sourcevision.ask", "web.sidecar"]);
  });

  it("marks fail-forward, auto-commit and the token budget column stable, still off by default", async () => {
    const body = await (await fetch(`${server.baseUrl}/api/features`)).json() as { toggles: Array<Record<string, unknown>> };
    for (const key of ["git.failForward", "git.autoCommitGenerated", "rex.showTokenBudget"]) {
      expect(body.toggles.find((t) => t.key === key), key).toMatchObject({ stability: "stable", defaultValue: false });
    }
  });

  it("lists none of the removed toggles, and still loads a config that stores them", async () => {
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({
      features: { sourcevision: { callGraph: true, enrichment: false }, hench: { guardRails: false } },
    }), "utf-8");
    const res = await fetch(`${server.baseUrl}/api/features`);
    expect(res.status).toBe(200);
    const keys = ((await res.json()) as { toggles: Array<{ key: string }> }).toggles.map((t) => t.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of REMOVED_KEYS) expect(keys).not.toContain(key);
  });

  it("lists rex.placementDraft as an off-by-default rex toggle, and reflects turning it on", async () => {
    const read = async () => {
      const body = await (await fetch(`${server.baseUrl}/api/features`)).json() as { toggles: Array<Record<string, unknown>> };
      return body.toggles.find((t) => t.key === "rex.placementDraft");
    };
    expect(await read()).toMatchObject({ package: "rex", stability: "experimental", defaultValue: false, enabled: false });
    expect((await put({ "rex.placementDraft": true })).status).toBe(200);
    expect(await read()).toMatchObject({ enabled: true });
  });

  it("lists hench.readyNext as an off-by-default experimental hench toggle", async () => {
    const body = await (await fetch(`${server.baseUrl}/api/features`)).json() as { toggles: Array<Record<string, unknown>> };
    expect(body.toggles.find((t) => t.key === "hench.readyNext"))
      .toMatchObject({ package: "hench", stability: "experimental", defaultValue: false, enabled: false });
  });

  it("describes hench.readyNext's groups as tracks, never lanes", async () => {
    const body = await (await fetch(`${server.baseUrl}/api/features`)).json() as { toggles: Array<Record<string, unknown>> };
    const description = String(body.toggles.find((t) => t.key === "hench.readyNext")?.description);
    expect(description).toContain("tracks of ready tasks");
    expect(description).not.toMatch(/\blanes?\b/i);
  });

  it("lists hench.runVerdict as an off-by-default experimental hench toggle", async () => {
    const body = await (await fetch(`${server.baseUrl}/api/features`)).json() as { toggles: Array<Record<string, unknown>> };
    expect(body.toggles.find((t) => t.key === "hench.runVerdict"))
      .toMatchObject({ package: "hench", stability: "experimental", defaultValue: false, enabled: false });
  });

  it("lists git.branchHealth as an off-by-default experimental git toggle", async () => {
    const body = await (await fetch(`${server.baseUrl}/api/features`)).json() as { toggles: Array<Record<string, unknown>> };
    expect(body.toggles.find((t) => t.key === "git.branchHealth"))
      .toMatchObject({ package: "git", stability: "experimental", defaultValue: false, enabled: false });
  });
});
