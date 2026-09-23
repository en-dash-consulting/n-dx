/**
 * POST /api/hench/execute must refuse a PRD tree this build would re-slug.
 *
 * The route spawns an autonomous run, and a run writes the PRD when it finishes
 * its task. So starting one against a tree written under a different slug rule
 * ships a whole-tree rewrite into whatever branch is open, under a "task
 * completed" commit — the same failure `ndx work` guards against, reached
 * through the dashboard instead. The spawned run would refuse the write itself,
 * but only after burning the tokens; and from the dashboard that reads as a run
 * that crashed a second after it started, with no stated reason.
 *
 * 412 Precondition Failed rather than 409: the request is well-formed and the
 * task is fine — the repository is in a state that forbids acting on it.
 *
 * The gate is asserted to run *before* the per-task checks, using a taskId that
 * does not exist: on a conformant tree that is a 404, on a non-conformant one a
 * 412. A repository-level fault reported as "task not found" would send the
 * operator looking at the wrong thing.
 *
 * @see packages/web/src/server/routes-hench.ts — refuseNonConformantTree
 * @see packages/rex/src/store/slug-rule-guard.ts — checkTreeConformance
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import {
  handleHenchRoute,
  resetHenchRouteStateForTests,
  shutdownActiveExecutions,
} from "../../../src/server/routes-hench.js";
import { resolveStore, PRD_TREE_DIRNAME } from "../../../src/server/rex-gateway.js";
import {
  startRouteTestServer,
  closeRouteTestServer,
  removeTestDir,
} from "../../helpers/server-route-test-support.js";

const TREE_META = "tree-meta.json";

const PRD = {
  schema: "rex/v1",
  title: "Execute Conformance",
  items: [
    {
      id: "epic-abc123",
      title: "Child Process Cleanup And Exit Hygiene",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        {
          id: "task-def456",
          title: "Harden the runner",
          level: "task" as const,
          status: "pending" as const,
        },
      ],
    },
  ],
};

describe("POST /api/hench/execute — PRD tree conformance gate", () => {
  let tmpDir: string;
  let rexDir: string;
  let treeRoot: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  async function execute(taskId: string): Promise<{ status: number; error?: string }> {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, error: body.error };
  }

  /** Rename the epic directory into the superseded id-qualified form. */
  async function reSuffixEpicDir(): Promise<string> {
    const entries = (await readdir(treeRoot)).filter((e) => e !== TREE_META);
    const foreign = "child-process-cleanup-and-exit-epicab";
    await rename(join(treeRoot, entries[0]), join(treeRoot, foreign));
    return foreign;
  }

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-conformance-"));
    rexDir = join(tmpDir, ".rex");
    treeRoot = join(rexDir, PRD_TREE_DIRNAME);
    await mkdir(rexDir, { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
      "utf-8",
    );
    await (await resolveStore(rexDir)).saveDocument(PRD as never);

    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    ({ server, port } = await startRouteTestServer((req, res) =>
      Promise.resolve(handleHenchRoute(req, res, ctx)),
    ));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await shutdownActiveExecutions(500).catch(() => {});
    await removeTestDir(tmpDir);
  });

  it("lets a conformant tree reach the per-task checks", async () => {
    // An unknown task is a 404 — which is only reachable past the gate.
    expect(await execute("task-nope")).toMatchObject({ status: 404 });
  });

  it("answers 412 naming the count and rex migrate-slugs on a re-slugged tree", async () => {
    await reSuffixEpicDir();

    const { status, error } = await execute("task-def456");

    expect(status).toBe(412);
    expect(error).toMatch(/1 path in the PRD tree does not match slug rule/);
    expect(error).toMatch(/rex migrate-slugs/);
  });

  it("names the offending path, so the operator sees the shape of the rewrite", async () => {
    const foreign = await reSuffixEpicDir();

    expect((await execute("task-def456")).error).toContain(foreign);
  });

  it("refuses ahead of the per-task checks, not after them", async () => {
    await reSuffixEpicDir();

    // Same unknown task that answers 404 on a conformant tree: the repository
    // fault is what the operator is told about, not the task they picked.
    expect(await execute("task-nope")).toMatchObject({ status: 412 });
  });

  /** Rewrite the marker to `slugRule`, leaving every path conformant. */
  async function markRule(offset: number): Promise<void> {
    const metaPath = join(rexDir, TREE_META);
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    await writeFile(
      metaPath,
      JSON.stringify({ ...meta, slugRule: meta.slugRule + offset }),
      "utf-8",
    );
  }

  it("refuses a foreign slug-rule marker even when every path conforms", async () => {
    await markRule(-1);

    const { status, error } = await execute("task-def456");

    expect(status).toBe(412);
    expect(error).toMatch(/rex migrate-slugs/);
  });

  // A rex build older than the marker rewrites the sidecar without it, erasing
  // the record while moving no path. The paths scan clean, so the absence
  // itself has to refuse — otherwise Execute starts an agent against a tree
  // whose guard someone has already taken off.
  it("refuses a missing slug-rule marker even when every path conforms", async () => {
    const metaPath = join(rexDir, TREE_META);
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    delete meta.slugRule;
    await writeFile(metaPath, JSON.stringify(meta), "utf-8");

    const { status, error } = await execute("task-def456");

    expect(status).toBe(412);
    expect(error).toMatch(/slug rule marker missing; run rex migrate-slugs/);
  });

  // `migrate-slugs` rewrites the tree under *this* build's rule, so advising
  // it for a newer tree walks the operator into a downgrade — and the newer
  // build, refused in turn, is advised to migrate it back.
  it("advises an upgrade, not a migration, when the tree's rule is newer", async () => {
    await markRule(1);

    const { status, error } = await execute("task-def456");

    expect(status).toBe(412);
    expect(error).toMatch(/Upgrade rex/);
    expect(error).not.toMatch(/Run 'rex migrate-slugs'/);
  });
});
