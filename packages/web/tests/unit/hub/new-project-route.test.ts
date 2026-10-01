/**
 * `GET /api/hub/new-project` and `POST /api/hub/projects/new`.
 *
 * The hub is stubbed down to what these two handlers touch — the project list,
 * `selfBin`, and `registerProject` — so the test is about the route's rules
 * (what it refuses, what it creates, what it registers) rather than about
 * spawning real project servers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { handleHubRoute } from "../../../src/hub/routes.js";
import type { Hub, ProjectView, RegisterProjectInput } from "../../../src/hub/hub.js";

/** Any port — the markers only have to record the one the hub reports. */
const HUB_PORT = 3117;

const readFileText = (path: string) => readFile(path, "utf-8");

function projectView(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "alpha",
    name: "alpha",
    repoRoot: join("/repos", "alpha"),
    worktrees: [join("/repos", "alpha")],
    ndxBin: join("/bin", "ndx.js"),
    port: 4001,
    pid: 100,
    lastSeen: null,
    status: { state: "healthy", port: 4001, pid: 100, restarts: 0, lastError: null },
    ...overrides,
  } as ProjectView;
}

interface StubHub {
  projects: ProjectView[];
  selfBin: string;
  registered: RegisterProjectInput[];
}

function stubHub(stub: StubHub): Hub {
  return {
    listProjects: () => stub.projects,
    listeningPort: HUB_PORT,
    getProject: (id: string) => stub.projects.find((p) => p.id === id) ?? null,
    selfBin: stub.selfBin,
    registerProject: vi.fn(async (input: RegisterProjectInput) => {
      stub.registered.push(input);
      const project = projectView({
        id: input.id,
        name: input.name ?? input.id,
        repoRoot: input.repoRoot,
        worktrees: [input.repoRoot],
        ndxBin: input.ndxBin,
      });
      stub.projects = [...stub.projects, project];
      return { created: true, project };
    }),
  } as unknown as Hub;
}

describe("hub route — creating a project folder", () => {
  let tmpDir: string;
  let binPath: string;
  let stub: StubHub;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hub-new-"));
    binPath = join(tmpDir, "ndx-cli.js");
    await writeFile(binPath, "// stand-in for @n-dx/web's CLI\n");
    stub = { projects: [], selfBin: binPath, registered: [] };

    server = createServer((req, res) => {
      void handleHubRoute(req, res, stubHub(stub)).then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(tmpDir, { recursive: true, force: true });
  });

  function preview(params: Record<string, string>) {
    const query = new URLSearchParams(params).toString();
    return fetch(`${base}/api/hub/new-project?${query}`).then(async (res) => ({
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    }));
  }

  function create(body: Record<string, unknown>) {
    return fetch(`${base}/api/hub/projects/new`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> }));
  }

  it("previews the exact path before anything exists", async () => {
    const { status, body } = await preview({ parent: tmpDir, name: "my-app" });
    expect(status).toBe(200);
    expect(body.path).toBe(join(tmpDir, "my-app"));
    expect(body.ok).toBe(true);
    expect(body.problem).toBeNull();
    // Previewing must not create anything.
    expect(existsSync(join(tmpDir, "my-app"))).toBe(false);
  });

  it("answers 200 with a problem for a path it would refuse, so typing is not an error", async () => {
    const { status, body } = await preview({ parent: tmpDir, name: "a/b" });
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(String(body.problem)).toMatch(/one folder/);
  });

  it("suggests where the registered projects already live", async () => {
    stub.projects = [
      projectView({ id: "a", repoRoot: join(tmpDir, "a") }),
      projectView({ id: "b", repoRoot: join(tmpDir, "b") }),
    ];
    const { body } = await preview({});
    expect(body.defaultParent).toBe(tmpDir);
    // With no parent typed, the preview is about the suggestion.
    expect(body.parent).toBe(tmpDir);
  });

  it("creates the folder and registers it with the hub's own binary", async () => {
    const { status, body } = await create({ parent: tmpDir, name: "my-app" });
    expect(status).toBe(201);
    expect(body.path).toBe(join(tmpDir, "my-app"));
    expect(body.url).toBe("/p/my-app/");
    expect(existsSync(join(tmpDir, "my-app"))).toBe(true);

    expect(stub.registered).toHaveLength(1);
    expect(stub.registered[0]).toMatchObject({
      id: "my-app",
      repoRoot: join(tmpDir, "my-app"),
      worktree: join(tmpDir, "my-app"),
      ndxBin: binPath,
      name: "my-app",
    });
  });

  it("creates an empty folder, not an initialized project — init is the wizard's job", async () => {
    await create({ parent: tmpDir, name: "bare" });
    // Only the hub's own marker files; nothing `ndx init` would write.
    expect((await readdir(join(tmpDir, "bare"))).sort()).toEqual([".n-dx-web.pid", ".n-dx-web.port"]);
  });

  it("leaves the markers `ndx start` writes, so `ndx start stop` works in the new folder", async () => {
    await create({ parent: tmpDir, name: "marked" });
    const marker = JSON.parse(await readFileText(join(tmpDir, "marked", ".n-dx-web.pid"))) as Record<string, unknown>;
    // `via: "hub"` is how every reader of that file knows not to kill the hub.
    expect(marker.via).toBe("hub");
    expect(marker.projectId).toBe("marked");
    expect(marker.port).toBe(HUB_PORT);
  });

  it("refuses to create what it would not preview, and writes nothing", async () => {
    await mkdir(join(tmpDir, "full"));
    await writeFile(join(tmpDir, "full", "file.txt"), "x");
    const { status, body } = await create({ parent: tmpDir, name: "full" });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/not empty/);
    expect(stub.registered).toHaveLength(0);
  });

  it("points at the existing project when the folder is already registered", async () => {
    await mkdir(join(tmpDir, "known"));
    stub.projects = [projectView({ id: "known", repoRoot: join(tmpDir, "known"), worktrees: [join(tmpDir, "known")] })];
    const { status, body } = await create({ parent: tmpDir, name: "known" });
    expect(status).toBe(409);
    expect(body.url).toBe("/p/known/");
    expect(stub.registered).toHaveLength(0);
  });

  it("gives a hub-created folder a distinct id when the slug is taken by another path", async () => {
    stub.projects = [projectView({ id: "my-app", repoRoot: join("/elsewhere", "my-app") })];
    const { body } = await create({ parent: tmpDir, name: "my-app" });
    expect(String(body.url)).toMatch(/^\/p\/my-app-[0-9a-f]{6}\/$/);
  });

  it("refuses rather than registering when the hub has no binary to run", async () => {
    stub.selfBin = "";
    const { status, body } = await create({ parent: tmpDir, name: "my-app" });
    expect(status).toBe(500);
    expect(String(body.error)).toMatch(/ndx start/);
    expect(existsSync(join(tmpDir, "my-app"))).toBe(false);
  });
});
