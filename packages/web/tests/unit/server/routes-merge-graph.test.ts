/**
 * Unit tests for the merge-graph HTTP route. We drive the route with an
 * injected cache so we don't have to spin up a real git repo.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import {
  handleMergeGraphRoute,
  clearMergeGraphCaches,
  clearPrdOriginCache,
  validateOriginPath,
} from "../../../src/server/routes-merge-graph.js";
import {
  MergeGraphCache,
  type GitRunner,
  type HenchRunSummary,
} from "../../../src/server/merge-history.js";
import { startRouteTestServer } from "../../helpers/server-route-test-support.js";

const FS = "\x1f";
const RS = "\x1e";

const AAA = "aaaaaaaa-1111-2222-3333-444444444444";

function prdFixture(): object {
  return {
    schema: "rex/v1",
    title: "test",
    items: [
      {
        id: AAA,
        title: "Epic A",
        level: "epic",
        status: "in_progress",
      },
    ],
  };
}

function makeStubRunner(overrides: Partial<{
  merges: string;
  nameStatus: string;
  head: string;
  count: string;
}> = {}): GitRunner {
  const merges =
    overrides.merges ??
    `sha_m${FS}p${FS}2024-01-01T00:00:00Z${FS}alice${FS}Merge branch 'task/${AAA}'${FS}body${RS}`;
  const nameStatus = overrides.nameStatus ?? "__NDXSHA__ sha_m\nA\tnew.ts";
  const head = overrides.head ?? "sha_m\n";
  const count = overrides.count ?? "1\n";

  return (args: string[]) => {
    if (args[0] === "log") return merges;
    if (args[0] === "show") return nameStatus;
    if (args[0] === "rev-list") {
      const key = args.join(" ");
      if (key.endsWith("-n 1 HEAD")) return head;
      if (key.includes("--count")) return count;
    }
    return "";
  };
}

describe("merge-graph route", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let cache: MergeGraphCache;
  let listRuns: () => HenchRunSummary[];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "merge-graph-route-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(join(tmpDir, ".rex", "prd.json"), JSON.stringify(prdFixture()));

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    cache = new MergeGraphCache();
    listRuns = () => [];

    clearMergeGraphCaches();

    const started = await startRouteTestServer((req, res) =>
      handleMergeGraphRoute(req, res, ctx, {
        cache,
        overrideBuildOptions: {
          gitRunner: makeStubRunner(),
          listHenchRuns: () => listRuns(),
        },
      }),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    clearMergeGraphCaches();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/merge-graph returns a graph payload", async () => {
    const res = await fetch(`http://localhost:${port}/api/merge-graph`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.generatedAt).toBeDefined();
    expect(body.fingerprint).toBeDefined();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.stats.merges).toBe(1);
    expect(body.stats.mergesWithPrdLinkage).toBe(1);
    const edge = body.edges.find((e: { attribution: string }) => e.attribution === "branch-name");
    expect(edge?.to).toBe(AAA);
  });

  it("GET /api/merge-graph/fingerprint returns just the fingerprint", async () => {
    const res = await fetch(`http://localhost:${port}/api/merge-graph/fingerprint`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fingerprint).toBeDefined();
    expect(body.fingerprint.headMergeSha).toBe("sha_m");
    expect(body.fingerprint.mergeCount).toBe(1);
  });

  it("rejects non-GET methods with 405", async () => {
    const res = await fetch(`http://localhost:${port}/api/merge-graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown paths under /api/merge-graph", async () => {
    const res = await fetch(`http://localhost:${port}/api/merge-graph/nope`);
    expect(res.status).toBe(404);
  });

  it("honors ?max= query parameter for bounded payloads", async () => {
    const res = await fetch(`http://localhost:${port}/api/merge-graph?max=10`);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/prd-origin
// ─────────────────────────────────────────────────────────────────────────────

describe("validateOriginPath", () => {
  it("accepts a slug-chain path", () => {
    expect(validateOriginPath("epic/feature/task")).toEqual({
      ok: true,
      path: "epic/feature/task",
    });
  });

  it("rejects empty / missing paths", () => {
    expect(validateOriginPath(null).ok).toBe(false);
    expect(validateOriginPath("").ok).toBe(false);
  });

  it("rejects path traversal markers", () => {
    expect(validateOriginPath("..").ok).toBe(false);
    expect(validateOriginPath("foo/..").ok).toBe(false);
    expect(validateOriginPath("foo/../bar").ok).toBe(false);
    expect(validateOriginPath("./foo").ok).toBe(false);
  });

  it("rejects absolute paths and backslashes and NUL", () => {
    expect(validateOriginPath("/abs").ok).toBe(false);
    expect(validateOriginPath("foo\\bar").ok).toBe(false);
    expect(validateOriginPath("foo\0bar").ok).toBe(false);
  });

  it("rejects empty path segments", () => {
    expect(validateOriginPath("foo//bar").ok).toBe(false);
    expect(validateOriginPath("foo/").ok).toBe(false);
  });

  it("rejects very long paths", () => {
    expect(validateOriginPath("a".repeat(2049)).ok).toBe(false);
  });
});

describe("/api/prd-origin route", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let gitCalls: string[][];

  function makeOriginRunner(opts: { result?: string } = {}): GitRunner {
    return (args: string[]) => {
      gitCalls.push(args);
      // The route only invokes git for `log` here; respond with the canned
      // output. Other args (rev-list, show) are unused on this endpoint.
      if (args[0] === "log") {
        return opts.result ?? "";
      }
      return "";
    };
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "prd-origin-route-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(join(tmpDir, ".rex", "prd.json"), JSON.stringify(prdFixture()));
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    gitCalls = [];
    clearMergeGraphCaches();
    clearPrdOriginCache();
  });

  afterEach(async () => {
    server.close();
    clearMergeGraphCaches();
    clearPrdOriginCache();
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function start(runner: GitRunner) {
    const started = await startRouteTestServer((req, res) =>
      handleMergeGraphRoute(req, res, ctx, {
        overrideBuildOptions: { gitRunner: runner },
      }),
    );
    server = started.server;
    port = started.port;
  }

  it("returns the parsed origin for a valid path", async () => {
    const result =
      `f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1${FS}` +
      `2026-05-02T10:00:00Z${FS}` +
      `Hal${FS}` +
      `hal@example.com${FS}` +
      `feat: introduce${FS}` +
      `Co-Authored-By: Claude <noreply@anthropic.com>${RS}`;
    await start(makeOriginRunner({ result }));

    const res = await fetch(`http://localhost:${port}/api/prd-origin?path=${encodeURIComponent("epic-one/feature-one")}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origin.shortSha).toBe("f1f1f1f");
    expect(body.origin.author).toBe("Hal");
    expect(body.origin.coAuthors).toEqual([
      { name: "Claude", email: "noreply@anthropic.com" },
    ]);
    // Verify the path passed to git is the .rex/prd_tree/<path>/index.md form.
    const logCall = gitCalls.find((a) => a[0] === "log");
    expect(logCall?.includes(".rex/prd_tree/epic-one/feature-one/index.md")).toBe(true);
  });

  it("returns origin: null when git produces no output", async () => {
    await start(makeOriginRunner({ result: "" }));

    const res = await fetch(`http://localhost:${port}/api/prd-origin?path=foo`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origin).toBeNull();
  });

  it("returns 400 for traversal / invalid paths", async () => {
    await start(makeOriginRunner());

    const cases = ["", "/abs", "..", "foo/../bar", "foo\\bar"];
    for (const path of cases) {
      const res = await fetch(`http://localhost:${port}/api/prd-origin?path=${encodeURIComponent(path)}`);
      expect(res.status, `path=${JSON.stringify(path)} should 400`).toBe(400);
    }
    // 400 short-circuits before invoking git.
    expect(gitCalls).toEqual([]);
  });

  it("caches subsequent lookups in the LRU (skips re-invoking git)", async () => {
    const result =
      `abc${FS}2026-01-01T00:00:00Z${FS}A${FS}a@x${FS}s${FS}${RS}`;
    await start(makeOriginRunner({ result }));

    const url = `http://localhost:${port}/api/prd-origin?path=foo`;
    const r1 = await fetch(url);
    expect(r1.status).toBe(200);
    const r2 = await fetch(url);
    expect(r2.status).toBe(200);

    // git invoked exactly once for the same key — second hit is served from
    // the LRU.
    const logCalls = gitCalls.filter((a) => a[0] === "log");
    expect(logCalls.length).toBe(1);
  });

  it("rejects non-GET methods with 405", async () => {
    await start(makeOriginRunner());

    const res = await fetch(`http://localhost:${port}/api/prd-origin?path=foo`, {
      method: "POST",
    });
    expect(res.status).toBe(405);
  });
});
