/**
 * A repository's identity, from its `.sourcevision/` manifest to its hub card.
 *
 * The unit tests either side of this one each hold a stub: the status route's
 * tests write artifacts and read JSON, and the hub's read a hand-built
 * snapshot. Neither proves the two halves agree about field names, which is
 * the only thing that can quietly break here — the hub's `ChildSnapshot` is a
 * structural subset of the server's `ProjectStatus`, not an import of it, and
 * a rename on one side would not fail a compile on the other.
 *
 * So this runs the real chain: a real project directory, the real
 * `handleStatusRoute` over a real socket, the real `fetchChildSnapshot`, and
 * the real card renderer. The one deliberate omission is the hub daemon and
 * its supervisor, which are `hub-daemon.test.ts`'s subject and would add a
 * child-process spawn per case for no extra coverage of this path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { handleStatusRoute, clearStatusCache } from "../../src/server/routes-status.js";
import type { ServerContext } from "../../src/server/types.js";
import { fetchChildSnapshot, toProjectCard } from "../../src/hub/overview.js";
import type { ProjectView } from "../../src/hub/index.js";
import { renderCard, repoLabel } from "../../src/hub/home.js";
import { closeRouteTestServer } from "../helpers/server-route-test-support.js";

const REPO = {
  name: "acme-api",
  remoteUrl: "git@github.com:acme/acme-api.git",
  remoteHost: "github.com",
  remotePath: "acme/acme-api",
  defaultBranch: "main",
};

let tmpDir: string;
let svDir: string;
let server: Server;
let port: number;

/** A project server answering only the status route — all a card is built from. */
function startChild(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolveStart) => {
    const s = createServer((req, res) => {
      if (handleStatusRoute(req, res, ctx)) return;
      // `/api/git/status` is the softer of the two calls the snapshot makes;
      // 404 here exercises the path where git could not be asked.
      res.writeHead(404);
      res.end("Not found");
    });
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      resolveStart({ server: s, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

/** The registry entry the card is joined onto. Registered name ≠ repository name. */
function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "acme-api-feature-x",
    name: "acme-api-feature-x",
    repoRoot: tmpDir,
    worktrees: [tmpDir],
    ndxBin: "/ndx",
    port,
    pid: process.pid,
    lastSeen: null,
    status: { state: "healthy", pid: process.pid, port, attached: false, respawns: 0, lastHealthAt: null, lastError: null },
    ...overrides,
  } as ProjectView;
}

async function writeAnalysis(manifestExtra: Record<string, unknown>): Promise<void> {
  await writeFile(
    join(svDir, "manifest.json"),
    JSON.stringify({
      schemaVersion: "1",
      toolVersion: "0.8.0",
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: { inventory: { status: "complete" } },
      ...manifestExtra,
    }),
  );
}

beforeEach(async () => {
  clearStatusCache();
  tmpDir = await mkdtemp(join(tmpdir(), "hub-cards-"));
  svDir = join(tmpDir, ".sourcevision");
  await mkdir(svDir, { recursive: true });
  await mkdir(join(tmpDir, ".rex"), { recursive: true });
  ({ server, port } = await startChild({ projectDir: tmpDir, svDir, rexDir: join(tmpDir, ".rex"), dev: false }));
});

afterEach(async () => {
  await closeRouteTestServer(server);
  await rm(tmpDir, { recursive: true, force: true });
});

describe("repo identity reaches a hub card over HTTP", () => {
  it("carries the manifest's repo from the child's status onto the rendered card", async () => {
    await writeAnalysis({ repo: REPO });

    const snapshot = await fetchChildSnapshot(port);
    expect(snapshot.error).toBeNull();
    expect(snapshot.status?.sv?.repo).toMatchObject({ name: "acme-api", remoteHost: "github.com" });

    const card = toProjectCard(project(), snapshot);
    expect(card.repoName).toBe("acme-api");
    expect(card.remoteHost).toBe("github.com");
    // The registered name is the worktree's; the repo name is the repository's.
    expect(card.name).toBe("acme-api-feature-x");

    const html = renderCard(card);
    expect(html).toContain("acme-api · github.com");
    expect(repoLabel(card)).toBe("acme-api · github.com");
  });

  it("renders a card with no repo line for a project analysed before the repo block existed", async () => {
    await writeAnalysis({});

    const card = toProjectCard(project(), await fetchChildSnapshot(port));
    expect(card.repoName).toBeNull();
    expect(card.remoteHost).toBeNull();
    // Still a card: the project is reachable and its other facts survive.
    expect(card.reachable).toBe(true);
    expect(renderCard(card)).not.toContain('class="repo"');
  });

  it("renders a card for a project with no analysis at all", async () => {
    const card = toProjectCard(project(), await fetchChildSnapshot(port));
    expect(card.reachable).toBe(true);
    expect(card.repoName).toBeNull();
    expect(card.analyzedAt).toBeNull();
    expect(renderCard(card)).toContain("acme-api-feature-x");
  });
});

describe("scan counts cross the same boundary", () => {
  it("reports outbound and infrastructure counts and a null readiness over HTTP", async () => {
    await writeAnalysis({ repo: REPO });
    await writeFile(
      join(svDir, "outbound.json"),
      JSON.stringify({
        dependencies: [
          { file: "a.ts", line: 3, kind: "http", target: "https://orders.internal", targetSource: "literal", client: "fetch", confidence: "certain" },
        ],
        contracts: [],
      }),
    );
    await writeFile(
      join(svDir, "infrastructure.json"),
      JSON.stringify({
        resources: [
          { id: "aws_sqs_queue.orders", kind: "queue", name: "orders", origin: "main.tf" },
          { id: "aws_s3_bucket.assets", kind: "bucket", name: "assets", origin: "main.tf" },
        ],
        seams: [],
        links: [],
        sawIaC: true,
      }),
    );

    const snapshot = await fetchChildSnapshot(port);
    const sv = snapshot.status?.sv as Record<string, unknown> | undefined;
    expect(sv?.["outbound"]).toBe(1);
    expect(sv?.["infrastructure"]).toBe(2);
    // Present and null — not absent — so the scorer can fill it in later
    // without the hub having a second response shape to handle.
    expect(sv).toHaveProperty("readiness");
    expect(sv?.["readiness"]).toBeNull();
  });
});

describe("the hub reads no .sourcevision path", () => {
  it("has no sourcevision file access anywhere in src/hub/", async () => {
    // The rule the whole design rests on: new analysis data reaches the hub
    // through the child's HTTP API and nowhere else. A `.sourcevision` path
    // or a data-file name in this zone would mean a second, divergent reader
    // — and one that silently reads the wrong worktree for a registered
    // project whose server is serving a different one.
    const hubDir = resolve(fileURLToPath(import.meta.url), "../../../src/hub");
    const files = (await readdir(hubDir)).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(join(hubDir, file), "utf-8");
      // Strip comments — `overview.ts` names sourcevision in prose, which is
      // documentation of where the data came from, not a read of it.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file} must not reference .sourcevision`).not.toContain(".sourcevision");
      expect(code, `${file} must not read sourcevision data files`).not.toMatch(
        /manifest\.json|outbound\.json|infrastructure\.json|sdlc-profile\.json/,
      );
    }
  });
});
