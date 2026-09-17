/**
 * A dashboard PRD write lands in the workspace the request addressed.
 *
 * Every PRD-writing route resolves its store from `ctx.rexDir`, and since PR
 * 12 that ctx is the one the `/w/<key>/` slot picked — so a PATCH under the
 * slot must rewrite *that worktree's* `.rex/prd_tree/` and leave the anchor's
 * byte-identical, and a slot-less PATCH must do the reverse.
 *
 * The assertion is a content hash of every file in each tree, taken before
 * and after each write. A weaker check — "the edited item has the new status"
 * — would pass even if the route had written both trees, which is the failure
 * mode that matters: an edit made while viewing a branch silently changing the
 * anchor's PRD.
 *
 * Boots the compiled server in a child process (same driver pattern as
 * workspace-slot-dispatch.test.ts — `startServer` has no close handle, so the
 * child is the teardown) and seeds both trees through rex's own store, so the
 * on-disk shape is the real folder tree rather than a hand-written fixture.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveStore } from "@n-dx/rex";
import type { PRDDocument, PRDItem } from "../../src/server/rex-gateway.js";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";

const execFileAsync = promisify(execFile);
const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY_URL = pathToFileURL(join(WEB_PKG, "dist/server/start.js")).href;

const WORKSPACE_KEY = "app-feature";
const ANCHOR_TASK = "task-anchor";
const BRANCH_TASK = "task-branch";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function doc(title: string, taskId: string): PRDDocument {
  return {
    schema: "rex/v1",
    title,
    items: [
      {
        id: "epic-1",
        title: `${title} epic`,
        level: "epic",
        status: "pending",
        children: [
          {
            id: taskId,
            title: `${title} task`,
            level: "task",
            status: "pending",
            priority: "medium",
          },
        ],
      },
    ] as PRDItem[],
  } as PRDDocument;
}

/** Every file under a `.rex/prd_tree/`, relative path → content hash. */
function treeDigest(worktree: string): Record<string, string> {
  const root = join(worktree, ".rex", "prd_tree");
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(root);
  return out;
}

/** The status recorded for `taskId` in that worktree's tree. */
async function statusOf(worktree: string, taskId: string): Promise<string | undefined> {
  const store = await resolveStore(join(worktree, ".rex"));
  const loaded = await store.loadDocument();
  const stack: PRDItem[] = [...loaded.items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.id === taskId) return item.status;
    if (item.children) stack.push(...item.children);
  }
  return undefined;
}

/**
 * Boots on `repo`, waits for the worktree to be listed, then makes the two
 * writes in order — under the slot first, then slot-less — pausing between so
 * the parent can snapshot the trees in between.
 */
function driverScript(repo: string, handshake: string): string {
  return `
import { writeFileSync, existsSync } from "node:fs";
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};
const { port } = await startServer(${JSON.stringify(repo)}, 0, {});
const base = "http://127.0.0.1:" + port;
const handshake = ${JSON.stringify(handshake)};

const deadline = Date.now() + 10_000;
for (;;) {
  const list = await (await fetch(base + "/api/workspaces")).json();
  if (list.workspaces.some((w) => w.key === ${JSON.stringify(WORKSPACE_KEY)})) break;
  if (Date.now() > deadline) { console.log("NDX_RESULT=" + JSON.stringify({ error: "worktree never listed", list })); process.exit(0); }
  await new Promise((r) => setTimeout(r, 100));
}

async function patch(path, body) {
  const res = await fetch(base + path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

const out = {};
out.slotWrite = await patch("/w/${WORKSPACE_KEY}/api/rex/items/${BRANCH_TASK}", { status: "in_progress" });

// Let the parent snapshot both trees before the second write.
writeFileSync(handshake + ".slot-done", "1");
const waitUntil = Date.now() + 30_000;
while (!existsSync(handshake + ".go") && Date.now() < waitUntil) {
  await new Promise((r) => setTimeout(r, 50));
}

out.anchorWrite = await patch("/api/rex/items/${ANCHOR_TASK}", { status: "in_progress" });
console.log("NDX_RESULT=" + JSON.stringify(out));
process.exit(0);
`;
}

let root: string;
let repo: string;
let linked: string;
let result: Record<string, { status: number; body: string }>;
/** Digests taken at each stage, keyed by worktree. */
let before: { anchor: Record<string, string>; branch: Record<string, string> };
let afterSlotWrite: { anchor: Record<string, string>; branch: Record<string, string> };
let afterAnchorWrite: { anchor: Record<string, string>; branch: Record<string, string> };

beforeAll(async () => {
  assertFreshServerBuild();
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-ws-writes-")));
  repo = join(root, "app");
  mkdirSync(join(repo, ".rex"), { recursive: true });
  mkdirSync(join(repo, ".sourcevision"), { recursive: true });
  await (await resolveStore(join(repo, ".rex"))).saveDocument(doc("Anchor", ANCHOR_TASK));
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "init");

  linked = join(root, WORKSPACE_KEY);
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  // The checkout carries the anchor's tree; replace it so the two are
  // distinguishable and the branch task exists only here.
  rmSync(join(linked, ".rex", "prd_tree"), { recursive: true, force: true });
  await (await resolveStore(join(linked, ".rex"))).saveDocument(doc("Branch", BRANCH_TASK));

  before = { anchor: treeDigest(repo), branch: treeDigest(linked) };

  const handshake = join(root, "handshake");
  const script = join(root, "driver.mjs");
  writeFileSync(script, driverScript(repo, handshake), "utf-8");

  const run = execFileAsync(process.execPath, [script], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

  // Snapshot between the two writes, then release the driver.
  const deadline = Date.now() + 60_000;
  while (!existsSync(`${handshake}.slot-done`) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  afterSlotWrite = { anchor: treeDigest(repo), branch: treeDigest(linked) };
  writeFileSync(`${handshake}.go`, "1");

  let stdout = "";
  try {
    ({ stdout } = await run);
  } catch (err) {
    stdout = (err as { stdout?: string }).stdout ?? "";
    throw new Error(`driver failed: ${(err as Error).message}\n${(err as { stderr?: string }).stderr ?? ""}`);
  }
  const match = /NDX_RESULT=(.+)/.exec(stdout);
  if (!match) throw new Error(`driver printed no result:\n${stdout}`);
  const parsed = JSON.parse(match[1]);
  if (parsed.error) throw new Error(`${parsed.error}: ${JSON.stringify(parsed.list)}`);
  result = parsed;

  afterAnchorWrite = { anchor: treeDigest(repo), branch: treeDigest(linked) };
}, 180_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("PRD writes go to the workspace the request addressed", () => {
  it("accepts both writes", () => {
    expect(result.slotWrite.status).toBe(200);
    expect(result.anchorWrite.status).toBe(200);
  });

  it("a PATCH under /w/<wt>/ rewrites that worktree's tree", async () => {
    expect(afterSlotWrite.branch).not.toEqual(before.branch);
    expect(await statusOf(linked, BRANCH_TASK)).toBe("in_progress");
  });

  it("…and leaves the anchor's tree byte-identical", () => {
    expect(afterSlotWrite.anchor).toEqual(before.anchor);
  });

  it("a slot-less PATCH rewrites the anchor's tree and not the worktree's", async () => {
    expect(afterAnchorWrite.anchor).not.toEqual(before.anchor);
    expect(await statusOf(repo, ANCHOR_TASK)).toBe("in_progress");
    expect(afterAnchorWrite.branch).toEqual(afterSlotWrite.branch);
  });

  it("neither tree gained the other's task — there is no cross-workspace write", async () => {
    expect(await statusOf(repo, BRANCH_TASK)).toBeUndefined();
    expect(await statusOf(linked, ANCHOR_TASK)).toBeUndefined();
  });
});
