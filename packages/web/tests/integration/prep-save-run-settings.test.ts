/**
 * `PUT /api/hench/prep/:taskId` — saving a task's own run settings.
 *
 * The write goes through rex's store against a real folder tree, so what is
 * pinned here is the behaviour a hand-written fixture cannot show: the block
 * actually lands on disk in the form `ndx work` reads back, the version check
 * refuses a save made against a stale read, and a write addressed to one
 * workspace leaves the other's tree untouched.
 *
 * The version is deliberately a fingerprint of the saved block rather than the
 * item's `lastModified`: renaming a task must not invalidate a run-settings
 * version the renamer never touched.
 *
 * @see packages/web/src/server/routes-hench-prep.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

import { resolveStore } from "@n-dx/rex";
import type { PRDDocument, PRDItem } from "../../src/server/rex-gateway.js";
import type { ServerContext } from "../../src/server/types.js";
import { handleHenchPrepRoute } from "../../src/server/routes-hench-prep.js";
import { startRouteTestServer, closeRouteTestServer } from "../helpers/server-route-test-support.js";

interface Served {
  server: Server;
  port: number;
}

function doc(title: string): PRDDocument {
  return {
    schema: "rex/v1",
    title,
    items: [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-1", title: "Save me", level: "task", status: "pending", priority: "medium" },
          { id: "task-2", title: "Other", level: "task", status: "pending", priority: "low" },
        ],
      },
    ] as PRDItem[],
  } as PRDDocument;
}

/** A content hash of every file in a tree, so "nothing changed" is provable. */
function hashTree(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string): void => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p.slice(dir.length)).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

async function seed(dir: string, title: string): Promise<ServerContext> {
  const rexDir = join(dir, ".rex");
  await mkdir(join(rexDir, ".cache"), { recursive: true });
  await mkdir(join(dir, ".hench", "runs"), { recursive: true });
  await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
  await (await resolveStore(rexDir)).saveDocument(doc(title) as never);
  return { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir, dev: false };
}

describe("PUT /api/hench/prep/:taskId", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let served: Served[];

  async function open(c: ServerContext): Promise<number> {
    const s = await startRouteTestServer((req, res) => handleHenchPrepRoute(req, res, c));
    served.push(s);
    return s.port;
  }

  async function save(port: number, body: unknown, taskId = "task-1"): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/api/hench/prep/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** The `run` block as rex reads it back off disk. */
  async function storedRun(c: ServerContext, taskId = "task-1"): Promise<unknown> {
    const loaded = (await (await resolveStore(c.rexDir)).loadDocument()) as PRDDocument;
    const epic = loaded.items[0] as PRDItem;
    return (epic.children ?? []).find((i) => i.id === taskId)?.run ?? null;
  }

  beforeEach(async () => {
    served = [];
    tmpDir = realpathSync.native(await mkdtemp(join(tmpdir(), "prep-save-")));
    ctx = await seed(tmpDir, "anchor");
  });

  afterEach(async () => {
    for (const s of served) await closeRouteTestServer(s.server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves a block and reports the version a later save must send", async () => {
    const port = await open(ctx);
    const res = await save(port, { run: { tier: "heavy", review: true }, version: "none" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toEqual({ tier: "heavy", review: true });
    expect(body.version).not.toBe("none");
    expect(body.workspace).toMatchObject({ isAnchor: true });

    // It is on disk in the form `ndx work` reads, not merely echoed back.
    expect(await storedRun(ctx)).toEqual({ tier: "heavy", review: true });
  });

  it("reports the stored version from GET, so a save can be made against it", async () => {
    const port = await open(ctx);
    await save(port, { run: { maxTurns: 7 }, version: "none" });

    // The GET spawns `ndx work --resolve`, which this fixture has no vendor CLI
    // for; the route still answers the PRD-derived fields, which is what the
    // version comes from. Read it off a second save instead of the spawn.
    const again = await save(port, { run: { maxTurns: 8 }, version: "none" });
    expect(again.status).toBe(409);
    const conflict = await again.json();
    expect(conflict.conflict).toBe(true);
    expect(conflict.saved).toEqual({ maxTurns: 7 });

    // Resending with the version the refusal named is the overwrite.
    const overwrite = await save(port, { run: { maxTurns: 8 }, version: conflict.version });
    expect(overwrite.status).toBe(200);
    expect(await storedRun(ctx)).toEqual({ maxTurns: 8 });
  });

  it("clears the block with null, and a cleared task is back at version none", async () => {
    const port = await open(ctx);
    const first = await save(port, { run: { tier: "light" }, version: "none" });
    const { version } = await first.json();

    const cleared = await save(port, { run: null, version });
    expect(cleared.status).toBe(200);
    const body = await cleared.json();
    expect(body.saved).toBeNull();
    expect(body.version).toBe("none");
    expect(await storedRun(ctx)).toBeFalsy();
  });

  it("treats an empty block as no block at all", async () => {
    const port = await open(ctx);
    const res = await save(port, { run: {}, version: "none" });

    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe("none");
    expect(await storedRun(ctx)).toBeFalsy();
  });

  it("gives two blocks that differ only in key order the same version", async () => {
    // Otherwise a client that serialized its keys differently would be told its
    // own save was someone else's change.
    const port = await open(ctx);
    const a = await save(port, { run: { tier: "heavy", review: true }, version: "none" });
    const first = (await a.json()).version;

    const b = await save(port, { run: { review: true, tier: "heavy" }, version: first });
    expect(b.status).toBe(200);
    expect((await b.json()).version).toBe(first);
  });

  describe("refusals", () => {
    it("refuses a launch-time key, naming it", async () => {
      const port = await open(ctx);
      for (const key of ["fresh", "allowDirty", "resetDeferred"]) {
        const res = await save(port, { run: { [key]: true }, version: "none" });
        expect(res.status, key).toBe(400);
        const body = await res.json();
        expect(body.key).toBe(key);
        expect(body.error).toMatch(/per launch/);
      }
      expect(await storedRun(ctx)).toBeFalsy();
    });

    it("refuses an unknown key through rex's own validator", async () => {
      const port = await open(ctx);
      const res = await save(port, { run: { nope: 1 }, version: "none" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/unknown key/i);
    });

    it("refuses a value outside its bounds", async () => {
      const port = await open(ctx);
      const res = await save(port, { run: { maxTurns: 9999 }, version: "none" });
      expect(res.status).toBe(400);
    });

    it("refuses a body with no version", async () => {
      const port = await open(ctx);
      const res = await save(port, { run: { tier: "light" } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/version/);
    });

    it("answers 404 for a task the PRD does not have", async () => {
      const port = await open(ctx);
      const res = await save(port, { run: { tier: "light" }, version: "none" }, "nope-1");
      expect(res.status).toBe(404);
    });

    it("refuses an epic, which cannot carry run settings", async () => {
      const port = await open(ctx);
      const res = await save(port, { run: { tier: "light" }, version: "none" }, "epic-1");
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/not a task or subtask/);
    });

    it("answers 404 for a workspace with no PRD at all", async () => {
      // The store would otherwise fail creating its lock file and the route
      // would answer 500, where "this project has no PRD" is a 404 — the same
      // answer the ready list gives.
      const bare = realpathSync.native(await mkdtemp(join(tmpdir(), "prep-save-bare-")));
      try {
        const port = await open({ projectDir: bare, svDir: join(bare, ".sourcevision"), rexDir: join(bare, ".rex"), dev: false });
        const res = await save(port, { run: { tier: "light" }, version: "none" });
        expect(res.status).toBe(404);
      } finally {
        await rm(bare, { recursive: true, force: true });
      }
    });

    it("refuses a foreign-site PUT before it writes anything", async () => {
      const port = await open(ctx);
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ run: { tier: "heavy" }, version: "none" }),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await storedRun(ctx)).toBeFalsy();
    });
  });

  it("writes only the workspace the request addressed", async () => {
    // Two contexts over two trees: the handler takes its store from ctx.rexDir,
    // so a save through one must leave the other byte-identical.
    const otherDir = realpathSync.native(await mkdtemp(join(tmpdir(), "prep-save-other-")));
    try {
      const other = await seed(otherDir, "branch");
      const before = hashTree(join(other.rexDir, "prd_tree"));

      const port = await open(ctx);
      expect((await save(port, { run: { tier: "heavy" }, version: "none" })).status).toBe(200);

      expect(await storedRun(ctx)).toEqual({ tier: "heavy" });
      expect(await storedRun(other)).toBeFalsy();
      expect(hashTree(join(other.rexDir, "prd_tree"))).toBe(before);
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  it("leaves a sibling task's settings alone", async () => {
    const port = await open(ctx);
    await save(port, { run: { tier: "heavy" }, version: "none" });
    await save(port, { run: { tier: "light" }, version: "none" }, "task-2");

    expect(await storedRun(ctx, "task-1")).toEqual({ tier: "heavy" });
    expect(await storedRun(ctx, "task-2")).toEqual({ tier: "light" });
  });
});
