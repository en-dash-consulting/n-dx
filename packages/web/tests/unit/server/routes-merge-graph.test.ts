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
