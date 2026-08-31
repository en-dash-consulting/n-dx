/**
 * Route tests for GET /api/iso-map.
 *
 * The handler builds sourcevision's isometric architecture map in memory and
 * streams it back as a standalone HTML document. These tests cover the happy
 * path against a fixture `.sourcevision/` directory, the `maxNodes` cap, and
 * the parameter validation surface.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleIsoMapRoute, parseIsoParams, MAX_MAX_NODES } from "../../../src/server/routes-iso-map.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";
import {
  ISO_MAP_DEFAULTS,
  ISO_MAP_MAX_NODES,
  ISO_MAP_SOURCES,
  buildIsoMapUrl,
  type IsoMapControls,
} from "../../../src/viewer/views/iso-map-url.js";

/** Three zones so a `maxNodes=1` request has something visible to drop. */
const zonesData = {
  schema: "sourcevision/v1",
  zones: [
    {
      id: "core",
      name: "Core",
      description: "Core logic",
      files: ["src/a.ts", "src/b.ts", "src/c.ts"],
      entryPoints: ["src/a.ts"],
      cohesion: 0.8,
      coupling: 0.2,
    },
    {
      id: "ui",
      name: "UI",
      description: "Interface",
      files: ["src/ui/x.tsx", "src/ui/y.tsx"],
      entryPoints: ["src/ui/x.tsx"],
      cohesion: 0.6,
      coupling: 0.3,
    },
    {
      id: "util",
      name: "Util",
      description: "Helpers",
      files: ["src/util/h.ts"],
      entryPoints: [],
      cohesion: 0.4,
      coupling: 0.5,
    },
  ],
  crossings: [{ fromZone: "ui", toZone: "core" }],
  findings: [],
};

const inventoryData = {
  schema: "sourcevision/v1",
  files: [
    { path: "src/a.ts", extension: ".ts", sizeBytes: 1024, lineCount: 50 },
    { path: "src/b.ts", extension: ".ts", sizeBytes: 512, lineCount: 25 },
    { path: "src/c.ts", extension: ".ts", sizeBytes: 512, lineCount: 25 },
    { path: "src/ui/x.tsx", extension: ".tsx", sizeBytes: 800, lineCount: 40 },
    { path: "src/ui/y.tsx", extension: ".tsx", sizeBytes: 400, lineCount: 20 },
    { path: "src/util/h.ts", extension: ".ts", sizeBytes: 200, lineCount: 10 },
  ],
  summary: { totalFiles: 6, totalLines: 170, totalSizeBytes: 3448 },
};

const importsData = {
  schema: "sourcevision/v1",
  edges: [{ from: "src/ui/x.tsx", to: "src/a.ts" }],
  external: [],
};

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return startRouteTestServer((req, res) => handleIsoMapRoute(req, res, ctx));
}

describe("parseIsoParams", () => {
  it("applies defaults for an empty query string", () => {
    const result = parseIsoParams(new URLSearchParams());
    expect(result).toEqual({
      ok: true,
      params: { source: "auto", maxNodes: 40, includeExternals: true },
    });
  });

  it("accepts every valid source mode", () => {
    for (const source of ["auto", "sourcevision", "scan"] as const) {
      const result = parseIsoParams(new URLSearchParams({ source }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.params.source).toBe(source);
    }
  });

  it("reads externals=0 as excluding externals", () => {
    const result = parseIsoParams(new URLSearchParams({ externals: "0" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.includeExternals).toBe(false);
  });

  it("rejects a non-numeric maxNodes", () => {
    const result = parseIsoParams(new URLSearchParams({ maxNodes: "fourty" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("maxNodes");
  });

  it("rejects maxNodes above the cap", () => {
    const result = parseIsoParams(new URLSearchParams({ maxNodes: String(MAX_MAX_NODES + 1) }));
    expect(result.ok).toBe(false);
  });

  it("rejects maxNodes of zero", () => {
    const result = parseIsoParams(new URLSearchParams({ maxNodes: "0" }));
    expect(result.ok).toBe(false);
  });
});

describe("GET /api/iso-map", () => {
  let tmpDir: string;
  let svDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "iso-map-"));
    svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, "zones.json"), JSON.stringify(zonesData));
    await writeFile(join(svDir, "inventory.json"), JSON.stringify(inventoryData));
    await writeFile(join(svDir, "imports.json"), JSON.stringify(importsData));

    ctx = { projectDir: tmpDir, svDir, rexDir: join(tmpDir, ".rex"), dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns a standalone HTML document by default", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    // All three fixture zones fit under the default cap of 40.
    expect(html).toContain("3 of 3 zones");
  });

  it("does not write anything to the project directory", async () => {
    const before = await import("node:fs").then((fs) => fs.readdirSync(tmpDir).sort());
    await fetch(`http://127.0.0.1:${port}/api/iso-map`);
    const after = await import("node:fs").then((fs) => fs.readdirSync(tmpDir).sort());
    expect(after).toEqual(before);
  });

  it("respects maxNodes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map?maxNodes=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("1 of 3 zones");
    // The largest zone by file count wins the single slot.
    expect(html).toContain("Core");
  });

  it("accepts source=sourcevision when analysis is present", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map?source=sourcevision`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("sourcevision analysis");
  });

  it("accepts externals=0", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map?externals=0`);
    expect(res.status).toBe(200);
  });

  it("rejects an invalid maxNodes with 400 and a helpful message", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map?maxNodes=-5`);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("maxNodes");
  });

  it("rejects an unknown source with 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map?source=nope`);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("source");
  });

  it("rejects an invalid externals value with 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map?externals=yes`);
    expect(res.status).toBe(400);
  });

  it("rejects non-GET methods with 405", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("does not claim unrelated paths", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map-other`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});

describe("GET /api/iso-map without analysis", () => {
  let tmpDir: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "iso-map-empty-"));
    const ctx: ServerContext = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 404 with guidance when source=sourcevision and no analysis exists", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map?source=sourcevision`);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("No sourcevision analysis found");
    expect(data.error).toContain("source=scan");
  });

  it("returns 404 with guidance when auto falls through to a scan that finds nothing", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/iso-map`);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("Nothing to map");
  });
});

/**
 * Viewer ↔ route contract.
 *
 * The Isometric Map view builds its request with `buildIsoMapUrl`, which
 * duplicates this route's bounds (the viewer must not import from src/server/).
 * These assertions keep the duplicate honest: every URL the controls can
 * produce must parse back to exactly the state that produced it.
 */
describe("buildIsoMapUrl round-trips through parseIsoParams", () => {
  function paramsOf(url: string): URLSearchParams {
    const qIdx = url.indexOf("?");
    return new URLSearchParams(qIdx === -1 ? "" : url.slice(qIdx + 1));
  }

  const cases: IsoMapControls[] = [
    ISO_MAP_DEFAULTS,
    { source: "sourcevision", maxNodes: 1, includeExternals: false },
    { source: "scan", maxNodes: MAX_MAX_NODES, includeExternals: true },
    { source: "auto", maxNodes: 137, includeExternals: false },
  ];

  for (const controls of cases) {
    it(`preserves ${JSON.stringify(controls)}`, () => {
      const parsed = parseIsoParams(paramsOf(buildIsoMapUrl(controls)));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.params.source).toBe(controls.source);
      expect(parsed.params.maxNodes).toBe(controls.maxNodes);
      expect(parsed.params.includeExternals).toBe(controls.includeExternals);
    });
  }

  it("accepts every source mode the view offers", () => {
    for (const source of ISO_MAP_SOURCES) {
      expect(parseIsoParams(paramsOf(buildIsoMapUrl({ ...ISO_MAP_DEFAULTS, source }))).ok).toBe(true);
    }
  });

  it("agrees with the route on the maxNodes ceiling", () => {
    expect(ISO_MAP_MAX_NODES).toBe(MAX_MAX_NODES);
  });
});
