/**
 * The /api/run-commands surface.
 *
 * The behaviour that matters most here is what the route *refuses*. It can
 * spawn processes on the developer's machine, so the tests below are mostly
 * about the ways a caller might try to choose what gets spawned, and the
 * answer being no in every one of them.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { isExecutableOnPath } from "@n-dx/llm-client";

import type { ServerContext } from "../../../src/server/types.js";
import {
  handleRunCommandsRoute,
  resetRunCommandJobs,
} from "../../../src/server/routes-run-commands.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

describe("/api/run-commands", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    resetRunCommandJobs();
    tmpDir = await mkdtemp(join(tmpdir(), "run-cmd-routes-"));
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) => handleRunCommandsRoute(req, res, ctx));
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    resetRunCommandJobs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  const base = () => `http://127.0.0.1:${port}/api/run-commands`;

  const post = (path: string, body?: unknown) =>
    fetch(`${base()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** A project whose only script finishes immediately. */
  async function nodeProject(scripts: Record<string, string>): Promise<void> {
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "x", scripts }));
  }

  describe("GET /api/run-commands", () => {
    it("lists nothing for a project with no detectable commands", async () => {
      const body = await (await fetch(base())).json();
      expect(body.commands).toEqual([]);
      expect(body.status.running).toBe(false);
    });

    it("lists the detected commands alongside the current job", async () => {
      await nodeProject({ dev: "node -e 0", build: "node -e 0" });
      const body = await (await fetch(base())).json();
      expect(body.commands.map((c: { id: string }) => c.id)).toEqual(["npm:dev", "npm:build"]);
      expect(body.status.running).toBe(false);
    });
  });

  describe("POST /api/run-commands/start", () => {
    it("refuses an id that detection did not produce", async () => {
      await nodeProject({ dev: "node -e 0" });
      const res = await post("/start", { id: "npm:definitely-not-a-script" });
      expect(res.status).toBe(404);
    });

    it("refuses a command the caller tries to supply directly", async () => {
      await nodeProject({ dev: "node -e 0" });
      // There is no parameter for a binary; naming one is simply an unknown id.
      const res = await post("/start", { id: "rm", bin: "rm", args: ["-rf", "/"] });
      expect(res.status).toBe(404);
    });

    it("requires an id", async () => {
      const res = await post("/start", {});
      expect(res.status).toBe(400);
    });

    it("rejects a malformed body", async () => {
      const res = await fetch(`${base()}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not json",
      });
      expect(res.status).toBe(400);
    });

    it("rejects extra arguments that are not strings", async () => {
      await nodeProject({ dev: "node -e 0" });
      const res = await post("/start", { id: "npm:dev", extraArgs: [{ evil: true }] });
      expect(res.status).toBe(400);
    });

    it("rejects an extra argument carrying a newline", async () => {
      await nodeProject({ dev: "node -e 0" });
      const res = await post("/start", { id: "npm:dev", extraArgs: ["--port\n--inspect"] });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/run-commands/stop", () => {
    it("answers 409 when nothing is running", async () => {
      const res = await post("/stop");
      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/run-commands/status", () => {
    it("starts empty", async () => {
      const body = await (await fetch(`${base()}/status`)).json();
      expect(body).toMatchObject({
        running: false,
        commandId: null,
        output: "",
        url: null,
        error: null,
      });
    });
  });

  describe("lifecycle", () => {
    // Python is the one interpreter detection offers that is cheap to start
    // and present on most developer machines. Where it is not, the lifecycle
    // goes uncovered rather than flaky.
    const bin = process.platform === "win32" ? "python" : "python3";
    const hasPython = isExecutableOnPath(bin);

    it.skipIf(!hasPython)("runs a command to completion and reports its output", async () => {
      await writeFile(join(tmpDir, "pyproject.toml"), "[project]\nname = \"x\"\n");
      await writeFile(join(tmpDir, "main.py"), "print('serving on http://127.0.0.1:4321/')\n");

      const started = await post("/start", { id: "python:main.py" });
      expect(started.status).toBe(202);

      // Poll until the process exits, the way the dashboard does.
      let status: { running: boolean; exitCode: number | null; url: string | null; output: string; error: string | null } | null = null;
      for (let i = 0; i < 100 && (status === null || status.running); i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = await (await fetch(`${base()}/status`)).json();
      }

      expect(status!.running).toBe(false);
      expect(status!.exitCode).toBe(0);
      expect(status!.error).toBeNull();
      expect(status!.output).toContain("serving on");
      // The port is read from what the process actually announced.
      expect(status!.url).toBe("http://localhost:4321/");
    }, 20_000);

    it.skipIf(!hasPython)("refuses a second command while one is running", async () => {
      await writeFile(join(tmpDir, "pyproject.toml"), "[project]\nname = \"x\"\n");
      // Sleeps long enough that the second request lands while it is up.
      await writeFile(join(tmpDir, "main.py"), "import time; time.sleep(5)\n");

      expect((await post("/start", { id: "python:main.py" })).status).toBe(202);
      const second = await post("/start", { id: "python:main.py" });
      expect(second.status).toBe(409);

      // Stop reports success and the job settles as stopped, not failed.
      expect((await post("/stop")).status).toBe(200);
      let status: { running: boolean; stopped: boolean; error: string | null } | null = null;
      for (let i = 0; i < 100 && (status === null || status.running); i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = await (await fetch(`${base()}/status`)).json();
      }
      expect(status!.running).toBe(false);
      expect(status!.error).toBeNull();
    }, 20_000);
  });

  it("does not handle an unrelated path", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/something-else`);
    // The test server answers 404 for anything the handler declines.
    expect(res.status).toBe(404);
  });
});
