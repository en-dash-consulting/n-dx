/**
 * `sv mcp .` follows the client's MCP roots (#499).
 *
 * Claude desktop spawns a worktree session's project MCP servers in the main
 * checkout A while the session works in linked worktree B; only `roots/list`
 * names B. These tests spawn the real stdio server with cwd = A and connect an
 * SDK client that answers `roots/list`. A and B hold `.sourcevision/` fixtures
 * that differ in content, so a read says which one was served, and a write
 * shows up as an uncommitted change in the tree it landed in.
 *
 * Needs sourcevision's dist/ (the server is spawned, not imported).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const SV_CLI = resolve(import.meta.dirname, "../../dist/cli/index.js");

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Uncommitted changes anywhere in the checkout — where a write landed. */
const changes = (worktree: string) => git(worktree, "status", "--porcelain", "--untracked-files=all").trim();

/** A minimal analysis whose file count says which checkout it came from. */
function writeAnalysis(dir: string, fileCount: number): void {
  const svDir = join(dir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });
  const files = Array.from({ length: fileCount }, (_, i) => ({
    path: `src/f${i}.ts`, size: 1, language: "TypeScript", lineCount: 1, hash: `h${i}`, role: "source", category: "src",
  }));
  writeFileSync(join(svDir, "manifest.json"), JSON.stringify({
    schemaVersion: "1.0.0", toolVersion: "0.0.0", analyzedAt: "2026-01-01T00:00:00.000Z", targetPath: dir, modules: {},
  }));
  writeFileSync(join(svDir, "inventory.json"), JSON.stringify({
    files,
    summary: { totalFiles: fileCount, totalLines: fileCount, byLanguage: {}, byRole: {}, byCategory: {} },
  }));
  writeFileSync(join(svDir, "classifications.json"), JSON.stringify({
    archetypes: [{ id: "utility", name: "Utility" }, { id: "entrypoint", name: "Entrypoint" }],
    files: [],
    summary: {},
  }));
}

let root: string;
/** Main checkout (1 file): the server's cwd. */
let wtA: string;
/** Linked worktree (2 files): the session's directory. */
let wtB: string;
/** A second linked worktree (3 files). */
let wtC: string;
/** A linked worktree whose `.sourcevision/` was removed: cannot be served. */
let wtD: string;
/** A repository without `.sourcevision/`. */
let bare: string;

beforeAll(() => {
  expect(existsSync(SV_CLI), `build sourcevision first: ${SV_CLI} is missing`).toBe(true);
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "sv-mcp-roots-")));
  wtA = join(root, "a");
  mkdirSync(wtA);
  git(wtA, "init", "--quiet", "--initial-branch=main");
  writeAnalysis(wtA, 1);
  git(wtA, "add", "-A");
  git(wtA, "commit", "--quiet", "-m", "analysis");
  wtB = join(root, "b");
  git(wtA, "worktree", "add", "--quiet", "-b", "b", wtB);
  writeAnalysis(wtB, 2);
  wtC = join(root, "c");
  git(wtA, "worktree", "add", "--quiet", "-b", "c", wtC);
  writeAnalysis(wtC, 3);
  wtD = join(root, "d");
  git(wtA, "worktree", "add", "--quiet", "-b", "d", wtD);
  rmSync(join(wtD, ".sourcevision"), { recursive: true, force: true });
  // B and C's analyses differ from A's, so commit them to keep status clean.
  for (const wt of [wtB, wtC]) {
    git(wt, "add", "-A");
    git(wt, "commit", "--quiet", "-m", "analysis");
  }
  git(wtD, "add", "-A");
  git(wtD, "commit", "--quiet", "-m", "no analysis");
  bare = join(root, "bare");
  mkdirSync(bare);
  git(bare, "init", "--quiet", "--initial-branch=main");
});

const open: Client[] = [];

afterEach(async () => {
  for (const client of open.splice(0)) await client.close();
  // Each case starts from committed trees.
  for (const wt of [wtA, wtB, wtC]) {
    git(wt, "checkout", "--quiet", "--", ".");
    git(wt, "clean", "--quiet", "-fd");
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
    args: [SV_CLI, "mcp", opts.dirArg ?? "."],
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

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

/** Files in the inventory the server answers from, and the checkout it names. */
async function served(client: Client): Promise<{ files: number; project: string }> {
  const { files, project } = JSON.parse((await call(client, "get_overview")).content[0].text);
  return { files, project };
}

const setArchetype = (client: Client) => call(client, "set_file_archetype", { path: "src/f0.ts", archetype: "entrypoint" });

describe("sv mcp . with cwd = main checkout", () => {
  it("reads and writes the worktree the client's roots name", async () => {
    const { client, stderr } = await connect({ cwd: wtA, roots: [wtB] });

    await expect(served(client)).resolves.toEqual({ files: 2, project: "b" });

    const result = await setArchetype(client);
    expect(result.isError).toBeFalsy();
    expect(changes(wtB)).toContain(".n-dx.json");
    expect(changes(wtA)).toBe("");
    expect(stderr()).toContain(`sourcevision mcp: serving ${wtB} (client root; started in ${wtA})`);
  });

  it("serves the main checkout to a client without roots, as before", async () => {
    const { client } = await connect({ cwd: wtA });

    await expect(served(client)).resolves.toEqual({ files: 1, project: "a" });
    expect((await setArchetype(client)).isError).toBeFalsy();
    expect(changes(wtA)).toContain(".n-dx.json");
    expect(changes(wtB)).toBe("");
  });

  it("moves later calls when the client's roots change", async () => {
    const { client, setRoots } = await connect({ cwd: wtA, roots: [wtB] });
    await expect(served(client)).resolves.toMatchObject({ files: 2 });

    await setRoots([wtC]);
    // The notification has no response; the next call waits for its resolution.
    await expect.poll(async () => (await served(client)).files).toBe(3);
    expect((await setArchetype(client)).isError).toBeFalsy();
    expect(changes(wtC)).toContain(".n-dx.json");
    expect(changes(wtA)).toBe("");
  });

  it("refuses the write for a worktree of the same repository it cannot serve, and reads the startup dir with a warning", async () => {
    const { client } = await connect({ cwd: wtA, roots: [wtD] });

    const refused = await setArchetype(client);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain(wtD);
    expect(refused.content[0].text).toContain(wtA);
    expect(changes(wtA)).toBe("");

    const overview = await call(client, "get_overview");
    expect(overview.isError).toBeFalsy();
    expect(JSON.parse(overview.content[0].text).files).toBe(1);
    expect(overview.content.at(-1)?.text).toContain(wtD);
  });
});

describe("sv mcp <absolute dir>", () => {
  it("ignores the client's roots", async () => {
    const { client } = await connect({ cwd: root, dirArg: wtA, roots: [wtB] });

    await expect(served(client)).resolves.toEqual({ files: 1, project: "a" });
    expect((await setArchetype(client)).isError).toBeFalsy();
    expect(changes(wtA)).toContain(".n-dx.json");
    expect(changes(wtB)).toBe("");
  });
});

describe("sv mcp . in a directory without .sourcevision/", () => {
  it("exits at startup, whatever the client's roots hold", () => {
    // The startup dir must hold an analysis; the server does not wait to see
    // whether a client root has one.
    const run = spawnSync(process.execPath, [SV_CLI, "mcp", "."], { cwd: bare, encoding: "utf-8", input: "", timeout: 20_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Sourcevision directory not found");
  });
});
