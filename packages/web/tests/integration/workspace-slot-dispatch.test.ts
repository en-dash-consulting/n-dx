/**
 * `/w/<key>/…` through the real server: the slot selects a worktree's data,
 * slot-less paths stay the anchor's, an unknown key is a 404 pointing home,
 * and the header form works for non-browser clients.
 *
 * Boots the compiled server in a child process on a repository with one
 * linked worktree (same driver pattern as scoped-route-dispatch.test.ts —
 * startServer has no close handle, so the child is the teardown).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";

const execFileAsync = promisify(execFile);
const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY_URL = pathToFileURL(join(WEB_PKG, "dist/server/start.js")).href;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function prdMd(title: string): string {
  return `---\nschema: rex/v1\ntitle: ${title}\nitems:\n  - id: e1\n    title: "${title} epic"\n    level: epic\n    status: pending\n---\n\n# ${title}\n`;
}

/** Boots on `repo`, waits for the worktree to be listed, probes, writes the result, exits. */
function driverScript(repo: string, key: string, resultPath: string): string {
  return `
import { writeFileSync } from "node:fs";
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};
const { port } = await startServer(${JSON.stringify(repo)}, 0, {});
const base = "http://127.0.0.1:" + port;
const key = ${JSON.stringify(key)};

// The result travels by file, not stdout: process.exit(0) below tears the
// server's live fs.watch handles down mid-flight, which on Windows can abort
// the process inside libuv (UV_HANDLE_CLOSING, win/async.c) before stdout is
// flushed. The sync file write is already durable when that happens, so the
// test can treat the exit code as advisory and the result as the contract.
const emit = (value) => writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(value));

// The registry refreshes its worktree list in the background at boot.
const deadline = Date.now() + 10_000;
for (;;) {
  const list = await (await fetch(base + "/api/workspaces")).json();
  if (list.workspaces.some((w) => w.key === key)) break;
  if (Date.now() > deadline) { emit({ error: "worktree never listed", list }); process.exit(0); }
  await new Promise((r) => setTimeout(r, 100));
}

async function probe(path, headers = {}) {
  const res = await fetch(base + path, { headers });
  const text = await res.text();
  return { status: res.status, type: res.headers.get("content-type") || "", text };
}
const out = {};
out.anchorStatus = JSON.parse((await probe("/api/status")).text).projectDir;
out.slotStatus = JSON.parse((await probe("/w/" + key + "/api/status")).text).projectDir;
out.headerStatus = JSON.parse((await probe("/api/status", { "x-ndx-workspace": key })).text).projectDir;
out.anchorPrd = JSON.parse((await probe("/data/prd.json")).text).title;
out.slotPrd = JSON.parse((await probe("/w/" + key + "/data/prd.json")).text).title;
const page = await probe("/w/" + key + "/prd");
out.slotPage = { status: page.status, html: page.type.includes("text/html") };
const bare = await probe("/w/" + key);
out.slotBare = { status: bare.status, html: bare.type.includes("text/html") };
const unknown = await probe("/w/nope/prd");
out.unknown = { status: unknown.status, html: unknown.type.includes("text/html"), linksHome: unknown.text.includes('href="/"'), namesKey: unknown.text.includes("nope") };
out.anchorPage = (await probe("/prd")).status;

// The header outranks the slot. This is how the Workspaces board acts on
// another worktree: its own page is served under a slot, so every fetch it
// makes carries that slot, and only the header can say which worktree the
// request is actually about.
out.headerBeatsSlot = JSON.parse(
  (await probe("/w/" + key + "/api/status", { "x-ndx-workspace": "app" })).text,
).projectDir;
out.slotStillWinsOverNothing = JSON.parse((await probe("/w/" + key + "/api/status")).text).projectDir;
// An unknown header key falls back rather than 404ing a whole dashboard, and
// must not promote itself over a slot that does name a worktree.
out.unknownHeaderKeepsSlot = JSON.parse(
  (await probe("/w/" + key + "/api/status", { "x-ndx-workspace": "no-such-worktree" })).text,
).projectDir;

// Snapshot what is known before the next probe: that one can take the whole
// server down, and an intermediate emit means the earlier results still reach
// the test instead of the run reporting only "the driver died".
emit(out);

// A malformed percent-escape in the slot: decoding it throws, and an
// exception in the request handler is an unhandled rejection that ends the
// process. It must answer, and the server must still be there afterwards.
const malformed = await probe("/w/%/api/status");
out.malformedSlot = malformed.status;
out.aliveAfterMalformed = (await probe("/api/status")).status;
emit(out);
process.exit(0);
`;
}

let root: string;
let repo: string;
let linked: string;
let result: Record<string, any>;

beforeAll(async () => {
  assertFreshServerBuild();
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-slot-dispatch-")));
  repo = join(root, "app");
  mkdirSync(join(repo, ".rex"), { recursive: true });
  mkdirSync(join(repo, ".sourcevision"), { recursive: true });
  writeFileSync(join(repo, ".rex", "prd.md"), prdMd("Anchor PRD"));
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "init");
  linked = join(root, "app-feature");
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  writeFileSync(join(linked, ".rex", "prd.md"), prdMd("Feature PRD"));

  const script = join(root, "driver.mjs");
  const resultPath = join(root, "driver-result.json");
  writeFileSync(script, driverScript(repo, "app-feature", resultPath), "utf-8");
  // The driver's exit code is advisory: its process.exit races the server's
  // live fs.watch handles and can abort inside libuv on Windows (see the
  // driver script). The written result file is the contract — a failed exec
  // matters only when no result made it to disk.
  let execError: Error | null = null;
  try {
    await execFileAsync(process.execPath, [script], { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    execError = err as Error;
  }
  try {
    result = JSON.parse(readFileSync(resultPath, "utf-8"));
  } catch {
    const stderr = (execError as { stderr?: string } | null)?.stderr ?? "";
    throw new Error(
      execError
        ? `driver failed before writing a result: ${execError.message}\n${stderr}`
        : "driver exited cleanly but wrote no result",
    );
  }
  if (result.error) throw new Error(`${result.error}: ${JSON.stringify(result.list)}`);
}, 120_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("/w/<key>/ dispatch through the real server", () => {
  it("the slot selects the worktree; slot-less paths and the header form behave as specified", () => {
    expect(result.anchorStatus).toBe(repo);
    expect(result.slotStatus).toBe(linked);
    expect(result.headerStatus).toBe(linked);
  });

  it("/w/<wt>/data/prd.json is wt's tree and /data/prd.json is the anchor's", () => {
    expect(result.anchorPrd).toBe("Anchor PRD");
    expect(result.slotPrd).toBe("Feature PRD");
  });

  it("the SPA is served under the slot, with and without a view, and at the anchor", () => {
    expect(result.slotPage).toEqual({ status: 200, html: true });
    expect(result.slotBare).toEqual({ status: 200, html: true });
    expect(result.anchorPage).toBe(200);
  });

  it("an unknown key is a 404 page that names the key and links to the anchor", () => {
    expect(result.unknown).toEqual({ status: 404, html: true, linksHome: true, namesKey: true });
  });

  // The Workspaces board is served under its own slot and addresses every
  // other worktree by header; a slot-first dispatcher sent its Start/Stop to
  // whichever worktree the board happened to be mounted on.
  it("X-Ndx-Workspace outranks the /w/<key>/ slot", () => {
    expect(result.headerBeatsSlot).toBe(repo);
    expect(result.slotStillWinsOverNothing).toBe(linked);
    expect(result.unknownHeaderKeepsSlot).toBe(linked);
  });

  it("a malformed escape in the slot is answered, not fatal", () => {
    expect(result.malformedSlot).toBe(404);
    expect(result.aliveAfterMalformed).toBe(200);
  });
});
