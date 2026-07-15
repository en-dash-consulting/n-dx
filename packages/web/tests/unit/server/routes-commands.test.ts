/**
 * Unit tests for the /api/commands/recommend route.
 *
 * Regression: `rex recommend --format=json` emits a JSON *array*. The handler
 * used to do `{ ok: true, ...parsed }`, which spread the array into numeric
 * object keys and dropped the count — so the dashboard's "Refresh
 * Recommendations" button could not read the result. The response must expose
 * the recommendations as a real array with a matching count.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

// Mock the CLI exec so the route returns controlled stdout without spawning rex.
// `vi.hoisted` makes execMock available inside the hoisted vi.mock factory.
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, exec: execMock };
});

import type { ServerContext } from "../../../src/server/types.js";
import { handleCommandsRoute } from "../../../src/server/routes-commands.js";
import { startRouteTestServer } from "../../helpers/server-route-test-support.js";

const RECOMMENDATIONS = [
  { id: "a", title: "Rec A", level: "feature", priority: "high", source: "sourcevision" },
  { id: "b", title: "Rec B", level: "task", priority: "medium", source: "sourcevision" },
  { id: "c", title: "Rec C", level: "task", priority: "low", source: "sourcevision" },
];

describe("commands route — recommend", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-route-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns recommendations as an array with a matching count", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify(RECOMMENDATIONS),
      stderr: "",
      error: null,
    });

    const res = await fetch(`http://localhost:${port}/api/commands/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    // The array must survive as an array — not be mangled into numeric keys.
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(body.recommendations).toHaveLength(3);
    expect(body.count).toBe(3);
    // Numeric-key leakage from an object spread must not be present.
    expect(body["0"]).toBeUndefined();
  });

  it("reports count 0 when there are no recommendations", async () => {
    execMock.mockResolvedValue({ stdout: "[]", stderr: "", error: null });

    const res = await fetch(`http://localhost:${port}/api/commands/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recommendations).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("falls back to raw output when stdout is not JSON", async () => {
    execMock.mockResolvedValue({
      stdout: "plain text summary, not json",
      stderr: "",
      error: null,
    });

    const res = await fetch(`http://localhost:${port}/api/commands/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.output).toContain("plain text summary");
    expect(body.recommendations).toBeUndefined();
  });
});
