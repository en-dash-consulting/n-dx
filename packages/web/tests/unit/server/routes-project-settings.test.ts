/**
 * `GET`/`PUT /api/project-settings` — and GitHub reads through it.
 *
 * `web.sidecarGithubReads` is served here as well as by the Sidecar's own
 * settings route, because branch health reads it with the Sidecar off, when
 * every `/api/sidecar` route refuses. It is saved exactly as the Sidecar route
 * saves it: to the user's local config, never the shared one.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveLayout } from "@n-dx/llm-client";
import { handleProjectSettingsRoute } from "../../../src/server/routes-project-settings.js";
import {
  startRouteTestServer,
  removeTestDir,
  type RouteTestServer,
} from "../../helpers/server-route-test-support.js";

let projectDir: string;
let server: RouteTestServer;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-project-settings-"));
  server = await startRouteTestServer((req, res) =>
    handleProjectSettingsRoute(req, res, { projectDir } as never),
  );
});

afterEach(async () => {
  await server.close();
  await removeTestDir(projectDir);
});

const get = async () => (await fetch(`${server.baseUrl}/api/project-settings`)).json() as Promise<Record<string, unknown>>;

function put(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${server.baseUrl}/api/project-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const readJson = async (file: string) => JSON.parse(await readFile(file, "utf-8")) as Record<string, Record<string, unknown>>;

describe("GitHub reads through /api/project-settings", () => {
  it("reports GitHub reads off by default", async () => {
    expect(await get()).toMatchObject({ githubReads: false });
  });

  it("saves GitHub reads to the local config, leaves the shared config alone, and reports it in force", async () => {
    const { configFile, localConfigFile } = resolveLayout(projectDir);
    const shared = JSON.stringify({ web: { port: 4000 } });
    await writeFile(configFile, shared, "utf-8");

    const res = await put({ githubReads: true });
    expect(res.status).toBe(200);
    const body = await res.json() as { applied: string[]; settings: Record<string, unknown> };
    expect(body.applied).toEqual(["web.sidecarGithubReads"]);
    expect(body.settings).toMatchObject({ githubReads: true, port: 4000 });

    expect((await readJson(localConfigFile)).web).toMatchObject({ sidecarGithubReads: true });
    // A Save that changes only GitHub reads does not rewrite the shared config.
    expect(await readFile(configFile, "utf-8")).toBe(shared);
    expect(await get()).toMatchObject({ githubReads: true });
  });

  it("clears GitHub reads with null", async () => {
    const { localConfigFile } = resolveLayout(projectDir);
    await put({ githubReads: true });
    expect((await put({ githubReads: null })).status).toBe(200);
    expect((await readJson(localConfigFile)).web?.sidecarGithubReads).toBeUndefined();
    expect(await get()).toMatchObject({ githubReads: false });
  });

  it("refuses a value that is not true, false or null, and writes nothing", async () => {
    const { configFile, localConfigFile } = resolveLayout(projectDir);
    const res = await put({ githubReads: "yes", port: 4000 });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("githubReads must be true or false");
    expect(existsSync(configFile)).toBe(false);
    expect(existsSync(localConfigFile)).toBe(false);
  });

  it("still writes the shared config for its own keys", async () => {
    const { configFile } = resolveLayout(projectDir);
    expect((await put({ port: 4000 })).status).toBe(200);
    expect((await readJson(configFile)).web).toMatchObject({ port: 4000 });
  });
});
