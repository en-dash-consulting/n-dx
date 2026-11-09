/**
 * The current branch's work set on the server: GET /api/rex/work-set, its Add
 * and Remove POSTs, and the three places a pick is narrowed to it (Ready to
 * run, Live's next queue and the Plan glance's next pick). A real git repo and
 * the v2 fixture: the branch is what decides everything here.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../src/server/types.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import { buildChangeSummary } from "../../src/server/routes-rex/product.js";
import { handleHenchPrepRoute } from "../../src/server/routes-hench-prep.js";
import { buildLiveSnapshot, clearLiveCaches } from "../../src/server/routes-live.js";
import { loadPrdModel, resolveStore } from "../../src/server/rex-gateway.js";
import type { WorkSetWire } from "../../src/server/routes-rex/work-set.js";
import { startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";
import { removeTempDir } from "../helpers/temp-dir.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";
/** A second task in the fixture change, which the tests put on a branch. */
const LOW = "c0000000-0000-4000-8000-0000000000a1";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe("branch work set routes", () => {
  let root: string;
  let ctx: ServerContext;
  let server: RouteTestServer;
  let frames: unknown[];

  const get = async (path: string) => (await fetch(`${server.baseUrl}${path}`)).json();
  const post = (path: string, body: unknown) =>
    fetch(`${server.baseUrl}/api/rex/work-set/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const workSet = () => get("/api/rex/work-set") as Promise<WorkSetWire>;
  const stateFile = () => join(ctx.rexDir, "changes", "add-apple-pay", "state.yaml");
  const readyIds = async () => ((await get("/api/hench/ready")) as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id).sort();

  beforeEach(async () => {
    frames = [];
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-work-set-routes-")));
    git(root, "init", "--quiet", "--initial-branch=main");
    writeFileSync(join(root, ".gitignore"), ".hench/\n.rex/\n.sourcevision/\n");
    git(root, "add", ".gitignore");
    git(root, "commit", "--quiet", "-m", "root");
    const rexDir = join(root, ".rex");
    cpSync(FIXTURE, rexDir, { recursive: true });
    writeFileSync(
      join(rexDir, "changes", "add-apple-pay", "polish-the-sheet.md"),
      `---\nid: "${LOW}"\ntype: "task"\ntitle: "Polish the sheet"\nslug: "polish-the-sheet"\npriority: "low"\n---\n`,
    );
    ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir, dev: false };
    server = await startRouteTestServer(async (req, res) => (await handleRexRoute(req, res, ctx, (f) => { frames.push(f); })) || handleHenchPrepRoute(req, res, ctx));
  });

  afterEach(async () => {
    await server.close();
    clearLiveCaches();
    await removeTempDir(root);
  });

  /** The change itself on the branch (its task inherits) and LOW on it in its own right. */
  function assignOwnAndInherited(branch: string): void {
    writeFileSync(
      stateFile(),
      `${readFileSync(stateFile(), "utf-8").trimEnd()}\n    delivery: {"branch": "${branch}"}\n  "${LOW}":\n    delivery: {"branch": "${branch}"}\n`,
    );
  }

  /** The PRD cache the dashboard keeps and Ready to run and Live read; the POSTs refresh it, a hand edit does not. */
  async function writeCache(): Promise<void> {
    const doc = await (await resolveStore(ctx.rexDir)).loadDocument();
    mkdirSync(join(ctx.rexDir, ".cache"), { recursive: true });
    writeFileSync(join(ctx.rexDir, ".cache", "prd.json"), JSON.stringify({ ...doc, product: (await loadPrdModel(ctx.rexDir)).tree.product }));
    clearLiveCaches();
  }

  describe("GET /api/rex/work-set", () => {
    it("reports no work set on the default branch and on a detached HEAD", async () => {
      expect(await workSet()).toEqual({ branch: null, workSet: false, groups: [], others: [] });
      git(root, "checkout", "--quiet", "--detach");
      expect(await workSet()).toEqual({ branch: null, workSet: false, groups: [], others: [] });
    });

    it("names the branch but reports no work set when nothing is assigned to it", async () => {
      git(root, "checkout", "--quiet", "-b", "feat/x");
      expect(await workSet()).toEqual({ branch: "feat/x", workSet: false, groups: [], others: [] });
    });

    it("groups the open units by change and marks the one that inherits its branch", async () => {
      git(root, "checkout", "--quiet", "-b", "feat/x");
      assignOwnAndInherited("feat/x");
      const read = await workSet();
      expect(read.branch).toBe("feat/x");
      expect(read.workSet).toBe(true);
      expect(read.groups).toHaveLength(1);
      expect(read.groups[0]!.change).toEqual({ id: CHANGE, displayId: "CH-1", title: "Add Apple Pay" });
      expect(read.groups[0]!.units.map(({ id, inherited }) => ({ id, inherited })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: TASK, inherited: true },
        { id: LOW, inherited: false },
      ]);
    });
  });

  it("never marks a unit that is on no branch as inherited, whether a task-less change or a task of an unassigned change", async () => {
    const SOLO = "c0000000-0000-4000-8000-0000000000b1";
    const solo = join(ctx.rexDir, "changes", "solo-change");
    mkdirSync(solo, { recursive: true });
    writeFileSync(join(solo, "index.md"), `---\nid: "${SOLO}"\ntype: "change"\ntitle: "Solo change"\nslug: "solo-change"\n---\n`);
    git(root, "checkout", "--quiet", "-b", "feat/x");
    // Only SOLO is on the branch; the fixture change and its tasks are on none.
    expect((await post("add", { ids: [SOLO] })).status).toBe(200);
    const read = await workSet();
    expect(read.groups.flatMap((g) => g.units)).toMatchObject([{ id: SOLO, inherited: false }]);
    const others = read.others.flatMap((g) => g.units);
    expect(others.map((u) => u.id)).toContain(TASK);
    expect(others.every((u) => !u.inherited)).toBe(true);
  });

  it("marks a task-less change that is on no branch as not inherited", async () => {
    const SOLO = "c0000000-0000-4000-8000-0000000000b1";
    const solo = join(ctx.rexDir, "changes", "solo-change");
    mkdirSync(solo, { recursive: true });
    writeFileSync(join(solo, "index.md"), `---\nid: "${SOLO}"\ntype: "change"\ntitle: "Solo change"\nslug: "solo-change"\n---\n`);
    git(root, "checkout", "--quiet", "-b", "feat/x");
    assignOwnAndInherited("feat/x");
    const others = (await workSet()).others;
    expect(others.find((g) => g.change.id === SOLO)?.units).toMatchObject([{ id: SOLO, inherited: false }]);
  });

  describe("POST add and remove", () => {
    it("adds a task through assign_to_branch, reports it, and removes it again", async () => {
      git(root, "checkout", "--quiet", "-b", "feat/x");
      const added = await post("add", { ids: [LOW] });
      expect(added.status).toBe(200);
      expect(await added.json()).toMatchObject({ branch: "feat/x", assigned: [{ id: LOW, title: "Polish the sheet" }], unchanged: [] });
      expect(frames).toContainEqual(expect.objectContaining({ type: "rex:prd-changed" }));
      expect((await workSet()).groups[0]!.units).toMatchObject([{ id: LOW, inherited: false }]);
      // The change's other open task is listed as not on the branch.
      expect((await workSet()).others.flatMap((g) => g.units.map((u) => u.id))).toContain(TASK);

      const removed = await post("remove", { ids: [LOW] });
      expect(removed.status).toBe(200);
      expect(await removed.json()).toMatchObject({ branch: "feat/x", removed: [{ id: LOW }] });
      expect((await workSet()).workSet).toBe(false);
    });

    it("refuses a task that is on another branch with its own code, and takes it with move", async () => {
      git(root, "checkout", "--quiet", "-b", "feat/x");
      await post("add", { ids: [LOW] });
      git(root, "checkout", "--quiet", "-b", "feat/y");
      const refused = await post("add", { ids: [LOW] });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: "ON_ANOTHER_BRANCH", error: expect.stringContaining("feat/x") });

      const moved = await post("add", { ids: [LOW], move: true });
      expect(moved.status).toBe(200);
      expect(await moved.json()).toMatchObject({ branch: "feat/y", assigned: [{ id: LOW, movedFrom: "feat/x" }] });
    });

    it("refuses on the default branch and a detached HEAD, writing nothing", async () => {
      const before = readFileSync(stateFile(), "utf-8");
      for (const path of ["add", "remove"]) {
        const onMain = await post(path, { ids: [LOW] });
        expect(onMain.status).toBe(409);
        expect(await onMain.json()).toMatchObject({ code: "NO_WORK_SET_BRANCH" });
      }
      git(root, "checkout", "--quiet", "--detach");
      const detached = await post("add", { ids: [LOW] });
      expect(detached.status).toBe(409);
      expect(await detached.json()).toMatchObject({ code: "NO_WORK_SET_BRANCH" });
      expect(readFileSync(stateFile(), "utf-8")).toBe(before);
    });

    it("refuses while a run is live in this checkout, writing nothing", async () => {
      git(root, "checkout", "--quiet", "-b", "feat/x");
      const locks = join(root, ".hench", "locks");
      mkdirSync(locks, { recursive: true });
      writeFileSync(join(locks, `${process.pid}.lock`), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId: TASK }));
      const before = readFileSync(stateFile(), "utf-8");
      for (const path of ["add", "remove"]) {
        const res = await post(path, { ids: [LOW] });
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "RUN_LIVE", error: expect.stringContaining(TASK) });
      }
      expect(readFileSync(stateFile(), "utf-8")).toBe(before);
    });

    it("answers 400 to empty or malformed ids", async () => {
      git(root, "checkout", "--quiet", "-b", "feat/x");
      for (const body of [{ ids: [] }, {}, { ids: "x" }, { ids: [1] }]) {
        expect((await post("add", body)).status).toBe(400);
      }
    });

    it("refuses an unknown id with the generic code", async () => {
      git(root, "checkout", "--quiet", "-b", "feat/x");
      const res = await post("add", { ids: ["no-such-task"] });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "WORK_SET_REFUSED" });
    });
  });

  describe("narrowing", () => {
    it("narrows Ready to run to the work set on a work-set branch and leaves main alone", async () => {
      await writeCache();
      expect(await readyIds()).toEqual([TASK, LOW].sort());
      git(root, "checkout", "--quiet", "-b", "feat/x");
      expect(await readyIds()).toEqual([TASK, LOW].sort());
      await post("add", { ids: [LOW] });
      expect(await readyIds()).toEqual([LOW]);
      git(root, "checkout", "--quiet", "main");
      expect(await readyIds()).toEqual([TASK, LOW].sort());
    });

    it("narrows Live's next queue the same way", async () => {
      const nextIds = (): string[] => buildLiveSnapshot(ctx, { listWorkspaces: () => [], memoryFloorBytes: () => null }).queue.next.map((t) => t.id).sort();

      await writeCache();
      expect(nextIds()).toEqual([TASK, LOW].sort());
      git(root, "checkout", "--quiet", "-b", "feat/x");
      await post("add", { ids: [LOW] });
      await writeCache();
      expect(nextIds()).toEqual([LOW]);
      // A checkout changes the branch, not the PRD: the memoised queue must not outlive it.
      git(root, "checkout", "--quiet", "main");
      expect(nextIds()).toEqual([TASK, LOW].sort());
    });

    it("narrows the Plan glance's next pick", async () => {
      const next = async () => buildChangeSummary((await loadPrdModel(ctx.rexDir)).tree, new Set(), root).next?.id;
      expect(await next()).toBe(TASK);
      git(root, "checkout", "--quiet", "-b", "feat/x");
      expect(await next()).toBe(TASK);
      await post("add", { ids: [LOW] });
      expect(await next()).toBe(LOW);
    });
  });
});
