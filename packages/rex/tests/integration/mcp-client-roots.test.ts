/**
 * `rex mcp .` follows the client's MCP roots (#499).
 *
 * Claude desktop spawns a worktree session's project MCP servers in the main
 * checkout A while the session works in linked worktree B; only `roots/list`
 * names B. These tests spawn the real stdio server with cwd = A and connect
 * an SDK client that answers `roots/list`, then check which tree a write
 * changed.
 *
 * Needs rex's dist/ (the server is spawned, not imported).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  serializeFolderTree,
  PRD_TREE_DIRNAME,
  TREE_META_FILENAME,
  SLUG_RULE_VERSION,
} from "../../src/store/index.js";
import { openClaimsStore } from "../../src/store/claims.js";
import { DEFAULT_CONFIG, type PRDDocument } from "../../src/schema/index.js";

const REX_CLI = resolve(import.meta.dirname, "../../dist/cli/index.js");

const PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Roots",
  items: [
    {
      id: "e1", title: "Epic", level: "epic", status: "pending",
      children: [
        { id: "t1", title: "Task one", level: "task", status: "pending", priority: "high", acceptanceCriteria: [] },
      ],
    },
  ],
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Uncommitted changes under `.rex/` — where a write landed. */
const rexChanges = (worktree: string) => git(worktree, "status", "--porcelain", "--untracked-files=all", "--", ".rex").trim();

let root: string;
/** Main checkout: the server's cwd. */
let wtA: string;
/** Linked worktree with `.rex/`: the session's directory. */
let wtB: string;
/** A second linked worktree with `.rex/`. */
let wtC: string;
/** A linked worktree whose `.rex/` was removed: cannot be served. */
let wtD: string;

beforeAll(async () => {
  expect(existsSync(REX_CLI), `build rex first: ${REX_CLI} is missing`).toBe(true);
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "rex-mcp-roots-")));
  wtA = join(root, "a");
  mkdirSync(wtA);
  git(wtA, "init", "--quiet", "--initial-branch=main");
  await serializeFolderTree(PRD.items, join(wtA, ".rex", PRD_TREE_DIRNAME));
  writeFileSync(
    join(wtA, ".rex", TREE_META_FILENAME),
    JSON.stringify({ title: PRD.title, schema: PRD.schema, slugRule: SLUG_RULE_VERSION }),
    "utf-8",
  );
  writeFileSync(join(wtA, ".rex", "config.json"), JSON.stringify(DEFAULT_CONFIG("roots")), "utf-8");
  git(wtA, "add", "-A");
  git(wtA, "commit", "--quiet", "-m", "prd");
  wtB = join(root, "b");
  git(wtA, "worktree", "add", "--quiet", "-b", "b", wtB);
  wtC = join(root, "c");
  git(wtA, "worktree", "add", "--quiet", "-b", "c", wtC);
  wtD = join(root, "d");
  git(wtA, "worktree", "add", "--quiet", "-b", "d", wtD);
  rmSync(join(wtD, ".rex"), { recursive: true, force: true });
});

const open: Client[] = [];

afterEach(async () => {
  for (const client of open.splice(0)) await client.close();
  // Each case starts from committed trees.
  for (const wt of [wtA, wtB, wtC]) {
    git(wt, "checkout", "--quiet", "--", ".rex");
    git(wt, "clean", "--quiet", "-fdx", "--", ".rex");
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

interface Connected {
  client: Client;
  /** Server stderr so far. */
  stderr: () => string;
  /** Change the roots the client reports and notify the server. */
  setRoots: (dirs: string[]) => Promise<void>;
}

async function connect(opts: { cwd: string; dirArg?: string; roots?: string[] }): Promise<Connected> {
  let roots = (opts.roots ?? []).map((dir) => ({ uri: pathToFileURL(dir).href }));
  const client = new Client(
    { name: "roots-test", version: "1.0.0" },
    opts.roots ? { capabilities: { roots: { listChanged: true } } } : {},
  );
  if (opts.roots) client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [REX_CLI, "mcp", opts.dirArg ?? "."],
    cwd: opts.cwd,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  await client.connect(transport);
  open.push(client);
  return {
    client,
    stderr: () => stderr,
    setRoots: async (dirs) => {
      roots = dirs.map((dir) => ({ uri: pathToFileURL(dir).href }));
      await client.sendRootsListChanged();
    },
  };
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean; warning?: string };

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

async function addEpic(client: Client, title: string): Promise<ToolResult> {
  return call(client, "add_item", { title, level: "epic" });
}

async function workspaceOf(client: Client): Promise<Record<string, unknown>> {
  const result = await call(client, "get_capabilities");
  return JSON.parse(result.content[0].text).workspace;
}

describe("rex mcp . with cwd = main checkout", () => {
  it("writes the worktree the client's roots name, and claims as that worktree", async () => {
    const { client, stderr } = await connect({ cwd: wtA, roots: [wtB] });

    const added = await addEpic(client, "Added from B");
    expect(added.isError).toBeFalsy();
    expect(rexChanges(wtB)).toContain(".rex/prd_tree/");
    expect(rexChanges(wtA)).toBe("");

    await expect(workspaceOf(client)).resolves.toEqual({
      projectDir: wtB,
      rexDir: join(wtB, ".rex"),
      source: "roots",
      startupDir: wtA,
    });
    expect(stderr()).toContain(`rex mcp: serving ${wtB} (client root; started in ${wtA})`);

    const claimed = await call(client, "claim_task", { id: "t1" });
    expect(claimed.isError).toBeFalsy();
    const claims = await openClaimsStore(wtA).readClaims();
    expect(claims).toEqual([expect.objectContaining({ taskId: "t1", worktreeRoot: wtB })]);
    await call(client, "release_task", { id: "t1" });
  });

  it("writes the main checkout for a client without roots, as before", async () => {
    const { client } = await connect({ cwd: wtA });

    expect((await addEpic(client, "Added without roots")).isError).toBeFalsy();
    expect(rexChanges(wtA)).toContain(".rex/prd_tree/");
    expect(rexChanges(wtB)).toBe("");
    await expect(workspaceOf(client)).resolves.toMatchObject({ projectDir: wtA, source: "startup" });
  });

  it("moves later writes when the client's roots change", async () => {
    const { client, setRoots } = await connect({ cwd: wtA, roots: [wtB] });
    expect((await addEpic(client, "First in B")).isError).toBeFalsy();
    expect(rexChanges(wtB)).not.toBe("");

    await setRoots([wtC]);
    // The notification has no response; the next call waits for its resolution.
    await expect.poll(async () => (await workspaceOf(client)).projectDir).toBe(wtC);
    expect((await addEpic(client, "Then in C")).isError).toBeFalsy();
    expect(rexChanges(wtC)).toContain(".rex/prd_tree/");
    expect(rexChanges(wtA)).toBe("");
  });

  it("refuses writes for a worktree of the same repository it cannot serve", async () => {
    const { client } = await connect({ cwd: wtA, roots: [wtD] });

    const refused = await addEpic(client, "Nowhere to go");
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain(wtD);
    expect(refused.content[0].text).toContain(wtA);
    expect(rexChanges(wtA)).toBe("");

    // Reads still answer, from the startup dir, with the reason attached.
    const status = await call(client, "get_prd_status");
    expect(status.isError).toBeFalsy();
    expect(JSON.parse(status.content[0].text).title).toBe("Roots");
    expect(status.warning).toContain(wtD);
  });
});

describe("rex mcp <absolute dir>", () => {
  it("ignores the client's roots", async () => {
    const { client } = await connect({ cwd: root, dirArg: wtA, roots: [wtB] });

    expect((await addEpic(client, "Explicit dir")).isError).toBeFalsy();
    expect(rexChanges(wtA)).toContain(".rex/prd_tree/");
    expect(rexChanges(wtB)).toBe("");
    await expect(workspaceOf(client)).resolves.toMatchObject({ projectDir: wtA, source: "startup" });
  });
});
