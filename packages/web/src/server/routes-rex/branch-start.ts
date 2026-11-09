/**
 * Start a branch for one or more open changes, from the Work and Plan pages.
 *
 *   GET  /api/rex/branch/start  → { branch, defaultBranch, changes }
 *   POST /api/rex/branch/start  { changeIds, name, base: "default" | "current" }
 *
 * The read gives the dialog what it offers: the open changes (with the `slug`
 * the name is prefilled from), the current branch (null on the default
 * branch and a detached HEAD), whether it has a work set (the only case where
 * stacking is offered) and the default
 * branch's name.
 *
 * The write cuts `name` from the base: the default branch (`origin/HEAD` when
 * it resolves, else `main`, else `master` — rex's `isDefaultBranch` rule) or the
 * current work-set branch. Then:
 *
 * - **Clean checkout, no live run** — switch to it, assign the changes through
 *   rex's `handleAssignToBranch` (the MCP `assign_to_branch` handler, which acts
 *   on the checked-out branch), and commit the PRD roots it changed with one
 *   `N-DX-Item` trailer per change. A failure after the branch exists switches
 *   back and deletes it, so nothing is left half-done.
 *   → `{ switched: true, branch, assigned }`
 * - **Dirty checkout or live run** — the branch is created and nothing else;
 *   an assignment is only ever recorded on the checked-out branch.
 *   → `{ switched: false, branch, reason, switchCommand }`
 *
 * Refusals: 400 `BAD_REQUEST`, `INVALID_NAME`; 409 `V1_LAYOUT`, `NOT_OPEN`,
 * `NAME_TAKEN`, `NO_WORK_SET_BRANCH` (stacking with no work-set branch checked out),
 * `NO_DEFAULT_BRANCH`. Nothing is created on any refusal.
 *
 * Git runs with argument arrays through llm-client's `exec`, never a shell.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { exec } from "@n-dx/llm-client";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { jsonResponse, errorMessage, readBody } from "../response-utils.js";
import { refreshPRDCache } from "../prd-io.js";
import { repositoryRunSlotUsage } from "../routes-hench.js";
import {
  currentWorkSetBranch,
  findNextWorkTask,
  handleAssignToBranch,
  indexTree,
  loadPrdModel,
  prdLayout,
  resolveStore,
  type V2Tree,
} from "../rex-gateway.js";

// ── Wire types ───────────────────────────────────────────────────────

export interface BranchStartChangeWire {
  id: string;
  displayId?: string;
  title: string;
  slug: string;
}

export interface BranchStartOptionsWire {
  /** The checked-out feature branch, or null (default branch, detached HEAD, no repo). */
  branch: string | null;
  /** The checked-out branch has a work set: the only case stacking on it is offered. */
  workSet: boolean;
  /** The default branch's name, or null when none resolves. */
  defaultBranch: string | null;
  /** Open changes, in tree order. */
  changes: BranchStartChangeWire[];
}

export type BranchStartBase = "default" | "current";

export type BranchStartReply =
  | { switched: true; branch: string; assigned: unknown[] }
  | { switched: false; branch: string; reason: "dirty" | "run-active"; switchCommand: string };

export type BranchStartRefusalCode =
  | "BAD_REQUEST"
  | "INVALID_NAME"
  | "V1_LAYOUT"
  | "NOT_OPEN"
  | "NAME_TAKEN"
  | "NO_WORK_SET_BRANCH"
  | "NO_DEFAULT_BRANCH";

/** The commit subject for the assignment. */
export const ASSIGN_COMMIT_SUBJECT = "chore(prd): assign changes to this branch";

// ── Routes ───────────────────────────────────────────────────────────

const START_PATH = "branch/start";
const OPEN_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "failing"]);
const GIT_TIMEOUT_MS = 15_000;

export function routeBranchStart(
  path: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  if (path !== START_PATH) return false;
  if (method === "GET") return handleOptions(res, ctx);
  if (method === "POST") return handleStart(req, res, ctx, broadcast);
  return false;
}

// ── Git ──────────────────────────────────────────────────────────────

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const r = await exec("git", args, { cwd, timeout: GIT_TIMEOUT_MS });
  return { ok: !r.error && r.exitCode === 0, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).ok;
}

/**
 * The default branch as a name and the ref to cut from: `origin/HEAD` when it
 * names a ref this clone has, else a local `main`, else `master`.
 */
async function resolveDefaultBranch(cwd: string): Promise<{ name: string; ref: string } | null> {
  const origin = await git(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const prefix = "refs/remotes/origin/";
  if (origin.ok && origin.stdout.startsWith(prefix) && (await refExists(cwd, origin.stdout))) {
    return { name: origin.stdout.slice(prefix.length), ref: origin.stdout };
  }
  for (const name of ["main", "master"]) {
    if (await refExists(cwd, `refs/heads/${name}`)) return { name, ref: `refs/heads/${name}` };
  }
  return null;
}

/** What HEAD is now, as `git switch` takes it back: a branch name, or a commit for a detached HEAD. */
async function currentHead(cwd: string): Promise<{ branch: string } | { detached: string } | null> {
  const sym = await git(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
  if (sym.ok && sym.stdout.startsWith("refs/heads/")) return { branch: sym.stdout.slice("refs/heads/".length) };
  const sha = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
  return sha.ok ? { detached: sha.stdout } : null;
}

// ── Read ─────────────────────────────────────────────────────────────

type TreeNode = V2Tree["changes"][number];

/** The checked-out branch holds a work set: the only branch a stacked one is cut from. */
function branchHasWorkSet(tree: V2Tree, cwd: string): boolean {
  return currentWorkSetBranch(cwd) !== null && findNextWorkTask(tree, { workspace: cwd }).workSet !== null;
}

function openChanges(tree: V2Tree): TreeNode[] {
  return indexTree(tree).entries
    .map(({ node }) => node)
    .filter((n) => n.type === "change" && OPEN_STATUSES.has(n.status ?? "pending"));
}

async function handleOptions(res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  try {
    const branch = currentWorkSetBranch(ctx.projectDir);
    const defaultBranch = (await resolveDefaultBranch(ctx.projectDir))?.name ?? null;
    const changes: BranchStartChangeWire[] = [];
    let workSet = false;
    if ((await prdLayout(ctx.rexDir)) === "v2") {
      const { tree } = await loadPrdModel(ctx.rexDir);
      workSet = branchHasWorkSet(tree, ctx.projectDir);
      for (const n of openChanges(tree)) {
        changes.push({ id: n.id, ...(n.displayId ? { displayId: n.displayId } : {}), title: n.title, slug: n.slug ?? n.id });
      }
    }
    const reply: BranchStartOptionsWire = { branch, workSet, defaultBranch, changes };
    jsonResponse(res, 200, reply);
  } catch (err) {
    jsonResponse(res, 500, { error: errorMessage(err) });
  }
  return true;
}

// ── Write ────────────────────────────────────────────────────────────

function refuse(res: ServerResponse, status: 400 | 409, code: BranchStartRefusalCode, error: string): true {
  jsonResponse(res, status, { error, code });
  return true;
}

function parseBody(raw: string): { changeIds: string[]; name: string; base: BranchStartBase } | { error: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return { error: "Request body must be JSON." };
  }
  const { changeIds, name, base } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(changeIds) || changeIds.length === 0 || !changeIds.every((id) => typeof id === "string" && id !== "")) {
    return { error: "changeIds must name at least one open change." };
  }
  if (typeof name !== "string" || name.trim() === "") return { error: "name must be a branch name." };
  if (base !== "default" && base !== "current") return { error: 'base must be "default" or "current".' };
  return { changeIds: [...new Set(changeIds as string[])], name: name.trim(), base };
}

async function handleStart(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const body = parseBody(await readBody(req, res));
  if ("error" in body) return refuse(res, 400, "BAD_REQUEST", body.error);
  const cwd = ctx.projectDir;

  try {
    if ((await prdLayout(ctx.rexDir)) !== "v2") {
      return refuse(res, 409, "V1_LAYOUT", "This project's PRD uses the v1 layout, which keeps no work sets. Migrate it first.");
    }
    const { tree } = await loadPrdModel(ctx.rexDir);
    const open = new Set(openChanges(tree).map((n) => n.id));
    const closed = body.changeIds.filter((id) => !open.has(id));
    if (closed.length > 0) return refuse(res, 409, "NOT_OPEN", `Not an open change: ${closed.join(", ")}.`);

    const checked = await git(cwd, ["check-ref-format", "--branch", body.name]);
    // `--branch` also expands `@{-1}` and the like; only a name that is its own expansion is a new branch name.
    if (body.name.startsWith("-") || !checked.ok || checked.stdout !== body.name) {
      return refuse(res, 400, "INVALID_NAME", `"${body.name}" is not a valid branch name.`);
    }
    if (await refExists(cwd, `refs/heads/${body.name}`)) {
      return refuse(res, 409, "NAME_TAKEN", `A branch named ${body.name} already exists.`);
    }

    const def = await resolveDefaultBranch(cwd);
    let baseRef: string;
    if (body.base === "current") {
      const current = currentWorkSetBranch(cwd);
      if (current === null || !branchHasWorkSet(tree, cwd)) {
        return refuse(res, 409, "NO_WORK_SET_BRANCH", "Stacking needs a branch with a work set checked out; this checkout is on the default branch, a detached HEAD or a branch nothing is assigned to.");
      }
      baseRef = `refs/heads/${current}`;
    } else {
      if (!def) return refuse(res, 409, "NO_DEFAULT_BRANCH", "No default branch resolves: origin/HEAD is unset and there is no main or master.");
      baseRef = def.ref;
    }
    if (def && body.name === def.name) {
      return refuse(res, 409, "NAME_TAKEN", `${body.name} is the default branch, which holds no work set.`);
    }

    // Decide before creating anything, so the answer matches what was done.
    // `--untracked-files=all` overrides a `status.showUntrackedFiles=no` config, which would hide a
    // just-captured change: the commit below would sweep it in, and a roll-back's `git clean` delete it.
    const status = await git(cwd, ["status", "--porcelain", "--untracked-files=all"]);
    if (!status.ok) throw new Error(`git status failed: ${status.stderr}`);
    const { here } = await repositoryRunSlotUsage(ctx);
    const reason = status.stdout !== "" ? "dirty" : here.length > 0 ? "run-active" : null;

    const head = await currentHead(cwd);
    if (!head) throw new Error("This checkout has no commit to branch from.");

    const created = await git(cwd, ["branch", "--no-track", body.name, baseRef]);
    if (!created.ok) throw new Error(`git branch failed: ${created.stderr}`);

    if (reason !== null) {
      const reply: BranchStartReply = { switched: false, branch: body.name, reason, switchCommand: `git switch ${body.name}` };
      jsonResponse(res, 200, reply);
      return true;
    }

    const assigned = await switchAssignCommit(ctx, body.name, body.changeIds, head);
    refreshPRDCache(ctx.rexDir, await (await resolveStore(ctx.rexDir)).loadDocument());
    broadcast?.({ type: "rex:prd-changed", timestamp: new Date().toISOString() });
    const reply: BranchStartReply = { switched: true, branch: body.name, assigned };
    jsonResponse(res, 200, reply);
  } catch (err) {
    const message = errorMessage(err);
    jsonResponse(res, message.includes("Could not acquire PRD lock") ? 409 : 500, { error: message });
  }
  return true;
}

/**
 * Switch to the new branch, assign the changes on it and commit the PRD roots
 * the assignment wrote. On any failure, discard what the assignment wrote,
 * switch back to `head` and delete the branch, then rethrow.
 */
async function switchAssignCommit(
  ctx: ServerContext,
  name: string,
  changeIds: string[],
  head: { branch: string } | { detached: string },
): Promise<unknown[]> {
  const cwd = ctx.projectDir;
  const rexRel = relative(cwd, ctx.rexDir).split(sep).join("/") || ".";
  // A pathspec that matches nothing fails `git add` and `git commit`: name only the roots this PRD has.
  const roots = ["changes", "product"].filter((r) => existsSync(join(ctx.rexDir, r))).map((r) => `${rexRel}/${r}`);
  let switched = false;
  try {
    const sw = await git(cwd, ["switch", "--quiet", name]);
    if (!sw.ok) throw new Error(`git switch failed: ${sw.stderr}`);
    switched = true;

    const result = await handleAssignToBranch(cwd, ctx.rexDir, { ids: changeIds });
    const text = result.content[0]?.text ?? "";
    if (result.isError) throw new Error(text);
    const { assigned } = JSON.parse(text) as { assigned?: unknown[] };

    const changed = await git(cwd, ["status", "--porcelain", "--untracked-files=all", "--", ...roots]);
    if (!changed.ok) throw new Error(`git status failed: ${changed.stderr}`);
    if (changed.stdout !== "") {
      const added = await git(cwd, ["add", "--all", "--", ...roots]);
      if (!added.ok) throw new Error(`git add failed: ${added.stderr}`);
      const trailers = changeIds.map((id) => `N-DX-Item: ${id}`).join("\n");
      const committed = await git(cwd, ["commit", "--quiet", "-m", ASSIGN_COMMIT_SUBJECT, "-m", trailers, "--", ...roots]);
      if (!committed.ok) throw new Error(`git commit failed: ${committed.stderr || committed.stdout}`);
    }
    return assigned ?? [];
  } catch (err) {
    await rollBack(cwd, name, head, switched, roots);
    throw err;
  }
}

/** Undo a start that failed after the branch was created. The checkout was clean before, so the PRD roots hold only the assignment's writes. */
async function rollBack(
  cwd: string,
  name: string,
  head: { branch: string } | { detached: string },
  switched: boolean,
  roots: string[],
): Promise<void> {
  if (switched) {
    await git(cwd, ["reset", "--quiet", "--", ...roots]);
    await git(cwd, ["checkout", "--quiet", "--", ...roots]);
    await git(cwd, ["clean", "--quiet", "--force", "--", ...roots]);
    const back = "branch" in head ? ["switch", "--quiet", head.branch] : ["switch", "--quiet", "--detach", head.detached];
    await git(cwd, back);
  }
  await git(cwd, ["branch", "--quiet", "-D", name]);
}
