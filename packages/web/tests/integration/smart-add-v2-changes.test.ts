/**
 * Integration test: Quick Add and batch import against a v2 PRD.
 *
 * A v2 tree (product/ and changes/) has no levels, so `rex add` answers with
 * changes rather than epic/feature/task proposals. The dashboard read only
 * `proposals`, which left Quick Add showing an empty preview with no way to
 * add anything. These tests cover the preview forwarding the changes and the
 * accept re-running `rex add --accept`.
 *
 * `exec` is mocked, so the rex envelopes below stand in for the CLI. They are
 * the shapes `packages/rex/src/cli/commands/add-change.ts` prints, pinned on
 * the rex side by "previews without writing under --format=json without
 * --accept (the dashboard's Quick Add)" in
 * `packages/rex/tests/unit/cli/commands/product-change-v2.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { readFileSync, existsSync, cpSync } from "node:fs";
import { removeTempDir } from "../helpers/temp-dir.js";
import { join, resolve } from "node:path";
import { resolveStore } from "@n-dx/rex";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";

// ── Mock @n-dx/llm-client ─────────────────────────────────────────────────

interface CapturedExec {
  cmd: string;
  args: string[];
  /** Contents of every `--file=<path>` argument, read while the file still exists. */
  files: Record<string, string>;
}

const execCalls: CapturedExec[] = [];
let mockExecResult: { stdout: string; stderr: string; exitCode: number | null; error: Error | null } = {
  stdout: "",
  stderr: "",
  exitCode: 0,
  error: null,
};

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...original,
    exec: vi.fn(async (cmd: string, args: string[]) => {
      // The route deletes its temp directory once rex returns, so the file
      // has to be read here, at the moment rex would have read it.
      const files: Record<string, string> = {};
      for (const arg of args) {
        if (arg.startsWith("--file=")) {
          const path = arg.slice("--file=".length);
          files[path] = readFileSync(path, "utf-8");
        }
      }
      execCalls.push({ cmd, args, files });
      return { ...mockExecResult };
    }),
  };
});

// Import AFTER mock registration
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import type { ServerContext } from "../../src/server/types.js";
import type { WebSocketBroadcaster } from "../../src/server/websocket.js";
import { closeRouteTestServer } from "../helpers/server-route-test-support.js";

// ── The v2 `rex add` fixtures ─────────────────────────────────────────────

/** `rex add --format=json --description "…"` on a v2 tree: a preview, nothing written. */
const V2_PREVIEW = {
  preview: true,
  changes: [
    {
      id: "01J9CHANGE0000000000000000",
      type: "change",
      title: "Support refunds when paying by card",
      needsPlacement: true,
      placement: {
        relation: "amends",
        shortlist: [
          {
            target: "01J9CAP00000000000000000000",
            relation: "amends",
            score: 4,
            reasons: ["title overlap with the capability statement"],
            title: "Pay by card",
            displayId: "A1.1",
          },
        ],
      },
    },
  ],
  proposals: [],
  qualityIssues: [],
};

/** The same command with `--accept`: the row it created, bare for a single change. */
const V2_ACCEPTED = {
  id: "01J9CHANGE0000000000000000",
  type: "change",
  title: "Support refunds when paying by card",
  needsPlacement: true,
  placement: V2_PREVIEW.changes[0].placement,
};

/** A v1 document on disk, so a route that wrote the v1 tree would be visible. */
function makeV1PRD() {
  return {
    schema: "rex/v1",
    title: "Test Project",
    items: [{ id: "epic-1", title: "Epic One", status: "pending", level: "epic", priority: "high", children: [] }],
  };
}

// ── Harness ───────────────────────────────────────────────────────────────

function startTestServer(ctx: ServerContext, broadcast: WebSocketBroadcaster): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const result = handleRexRoute(req, res, ctx, broadcast);
      if (result instanceof Promise) {
        if (await result) return;
      } else if (result) {
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

async function post(port: number, path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Quick Add on a v2 PRD", () => {
  let tmpDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let broadcasts: Array<{ type: string }>;

  beforeEach(async () => {
    execCalls.length = 0;
    broadcasts = [];
    mockExecResult = { stdout: JSON.stringify(V2_PREVIEW), stderr: "", exitCode: 0, error: null };

    tmpDir = await mkdtemp(join(tmpdir(), "smart-add-v2-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(rexDir, { recursive: true });
    await mkdir(svDir, { recursive: true });
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(makeV1PRD(), null, 2));

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx, ((frame: { type: string }) => {
      broadcasts.push(frame);
    }) as unknown as WebSocketBroadcaster);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await removeTempDir(tmpDir);
  });

  // ── Preview ───────────────────────────────────────────────────────────

  it("lists the changes rex add would create instead of an empty proposal list", async () => {
    const res = await post(port, "/api/rex/smart-add-preview", {
      text: "Support refunds when paying by card",
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.preview).toBe(true);
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0]).toMatchObject({
      title: "Support refunds when paying by card",
      needsPlacement: true,
    });
    // The whole point of the task: the user sees something to act on.
    expect(data.proposals).toEqual([]);
  });

  it("carries the suggested placement with the target named, not just its id", async () => {
    const res = await post(port, "/api/rex/smart-add-preview", {
      text: "Support refunds when paying by card",
    });

    const { changes } = await res.json();
    expect(changes[0].placement.relation).toBe("amends");
    expect(changes[0].placement.shortlist[0]).toMatchObject({
      relation: "amends",
      displayId: "A1.1",
      title: "Pay by card",
    });
  });

  it("writes nothing while previewing", async () => {
    await post(port, "/api/rex/smart-add-preview", { text: "Support refunds when paying by card" });

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).not.toContain("--accept");
    expect(broadcasts).toEqual([]);
  });

  // ── Accept ────────────────────────────────────────────────────────────

  it("creates the previewed changes by re-running rex add with --accept", async () => {
    mockExecResult = { stdout: JSON.stringify(V2_ACCEPTED), stderr: "", exitCode: 0, error: null };

    const res = await post(port, "/api/rex/smart-add-accept", {
      text: "Support refunds when paying by card",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // Criterion: the change lands in the Inbox, awaiting placement.
    expect(data.changes).toEqual([expect.objectContaining({ needsPlacement: true, type: "change" })]);

    expect(execCalls).toHaveLength(1);
    const { args } = execCalls[0];
    expect(args).toContain("add");
    expect(args).toContain("--accept");
    expect(args).toContain("--format=json");
    expect(args[args.length - 1]).toBe(tmpDir);

    // The text reaches rex through a file the server wrote, never as an argv
    // token: the command line carries nothing the user typed.
    expect(args).not.toContain("--description");
    const fileArg = args.find((a) => a.startsWith("--file="));
    expect(fileArg).toBeDefined();
    expect(execCalls[0].files[fileArg!.slice("--file=".length)]).toBe("Support refunds when paying by card");
    expect(args.some((a) => a.includes("Support refunds"))).toBe(false);
  });

  it("deletes the description file once rex has answered", async () => {
    mockExecResult = { stdout: JSON.stringify(V2_ACCEPTED), stderr: "", exitCode: 0, error: null };

    await post(port, "/api/rex/smart-add-accept", { text: "Support refunds when paying by card" });

    const fileArg = execCalls[0].args.find((a) => a.startsWith("--file="))!;
    expect(existsSync(fileArg.slice("--file=".length))).toBe(false);
  });

  it("does not write the v1 tree when accepting a change", async () => {
    mockExecResult = { stdout: JSON.stringify(V2_ACCEPTED), stderr: "", exitCode: 0, error: null };
    const before = await readFile(join(rexDir, "prd.json"), "utf-8");

    const res = await post(port, "/api/rex/smart-add-accept", {
      text: "Support refunds when paying by card",
    });

    expect(res.status).toBe(200);
    // rex owns the write; the route must not reach for the v1 store itself.
    expect(await readFile(join(rexDir, "prd.json"), "utf-8")).toBe(before);
  });

  it("broadcasts a PRD change so the dashboard refreshes", async () => {
    mockExecResult = { stdout: JSON.stringify(V2_ACCEPTED), stderr: "", exitCode: 0, error: null };

    await post(port, "/api/rex/smart-add-accept", { text: "Support refunds when paying by card" });

    expect(broadcasts.map((b) => b.type)).toContain("rex:prd-changed");
  });

  it("forwards the parent scope as --parent", async () => {
    mockExecResult = { stdout: JSON.stringify(V2_ACCEPTED), stderr: "", exitCode: 0, error: null };

    await post(port, "/api/rex/smart-add-accept", {
      text: "Support refunds when paying by card",
      parentId: "epic-1",
    });

    const { args } = execCalls[0];
    expect(args[args.indexOf("--parent") + 1]).toBe("epic-1");
  });

  it("refuses an empty accept without spawning rex", async () => {
    const res = await post(port, "/api/rex/smart-add-accept", { text: "   " });

    expect(res.status).toBe(400);
    expect(execCalls).toHaveLength(0);
  });

  it("refuses a parentId the PRD does not contain, so request text never reaches argv", async () => {
    for (const parentId of ["--parent", "-x", "CH 12", "a/b", "", "epic-2", "EPIC-1"]) {
      const res = await post(port, "/api/rex/smart-add-accept", {
        text: "Support refunds when paying by card",
        parentId,
      });
      expect(res.status, `parentId ${JSON.stringify(parentId)}`).toBe(400);
    }
    expect(execCalls).toHaveLength(0);
  });

  it("does not echo an error object or stack into the response", async () => {
    mockExecResult = { stdout: "", stderr: "", exitCode: 1, error: new Error("rex add failed") };

    const res = await post(port, "/api/rex/smart-add-accept", { text: "Support refunds when paying by card" });

    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).not.toMatch(/^Error:/);
    expect(error).not.toMatch(/\n\s+at /);
  });

  it("surfaces a CLI failure rather than reporting a silent success", async () => {
    mockExecResult = {
      stdout: "",
      stderr: "This PRD uses the v2 layout",
      exitCode: 1,
      error: new Error("rex add failed"),
    };

    const res = await post(port, "/api/rex/smart-add-accept", { text: "Support refunds" });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("v2 layout");
    expect(broadcasts).toEqual([]);
  });

  it("reports output that names no changes rather than claiming success", async () => {
    mockExecResult = { stdout: "Created change: Support refunds", stderr: "", exitCode: 0, error: null };

    const res = await post(port, "/api/rex/smart-add-accept", { text: "Support refunds" });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/did not report the changes/);
  });

  // ── Batch import ──────────────────────────────────────────────────────

  it("forwards the change preview for a batch import without accept", async () => {
    const res = await post(port, "/api/rex/batch-import", {
      items: [{ content: "Support refunds when paying by card" }],
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preview).toBe(true);
    expect(data.changes).toHaveLength(1);
    expect(data.proposals).toEqual([]);
    expect(data.itemCount).toBe(1);
  });

  it("counts and broadcasts an accepted batch import", async () => {
    mockExecResult = {
      stdout: JSON.stringify([V2_ACCEPTED, { ...V2_ACCEPTED, id: "01J9CHANGE0000000000000001", title: "Dark mode" }]),
      stderr: "",
      exitCode: 0,
      error: null,
    };

    const res = await post(port, "/api/rex/batch-import", {
      items: [{ content: "Support refunds when paying by card" }, { content: "Dark mode" }],
      accept: true,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.added).toBe(2);
    expect(data.changes).toHaveLength(2);
    expect(broadcasts.map((b) => b.type)).toContain("rex:prd-changed");
  });
});

/**
 * Capture-time placement on a real v2 tree: the preview's shortlist carries
 * what a choice needs, and each path the Preview offers lands where it says.
 * `rex add` stays mocked; the item route writes the tree for real.
 */
describe("Quick Add placement on a v2 tree", () => {
  const FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");
  const CAPABILITY_ID = "a0000000-0000-4000-8000-000000000002";

  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let port: number;

  /** rex's preview row: score and reasons, no strength, area or tie. */
  const previewWith = (shortlist: Array<Record<string, unknown>>) => ({
    ...V2_PREVIEW,
    changes: [{ ...V2_PREVIEW.changes[0], placement: { relation: "touches", shortlist } }],
  });

  beforeEach(async () => {
    execCalls.length = 0;
    tmpDir = await mkdtemp(join(tmpdir(), "smart-add-v2-place-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });
    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx, (() => {}) as unknown as WebSocketBroadcaster));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await removeTempDir(tmpDir);
  });

  it("completes each candidate with rex's strength band, the target's area and type, and the tie", async () => {
    mockExecResult = {
      stdout: JSON.stringify(previewWith([
        { target: CAPABILITY_ID, relation: "touches", score: 11, reasons: ["words: card"], title: "Pay by card", displayId: "A1.1" },
        { target: "a0000000-0000-4000-8000-000000000001", relation: "touches", score: 11, reasons: [], title: "Checkout" },
      ])),
      stderr: "", exitCode: 0, error: null,
    };

    const { changes } = await (await post(port, "/api/rex/smart-add-preview", { text: "Support refunds when paying by card" })).json();

    expect(changes[0].placement.tied).toBe(true);
    expect(changes[0].placement.shortlist[0]).toMatchObject({
      target: CAPABILITY_ID, type: "capability", area: "Checkout", score: 11, strength: "strong", reasons: ["words: card"],
    });
  });

  it("is untied when the top pick scores alone, and keeps a strength rex already sent", async () => {
    mockExecResult = {
      stdout: JSON.stringify(previewWith([
        { target: CAPABILITY_ID, relation: "touches", score: 12, strength: "strong", reasons: [] },
        { target: "unknown-target", relation: "touches", score: 3, reasons: [] },
      ])),
      stderr: "", exitCode: 0, error: null,
    };

    const { changes } = await (await post(port, "/api/rex/smart-add-preview", { text: "Support refunds when paying by card" })).json();

    expect(changes[0].placement.tied).toBe(false);
    expect(changes[0].placement.shortlist.map((c: { strength: string; area: string }) => [c.strength, c.area]))
      .toEqual([["strong", "Checkout"], ["weak", ""]]);
  });

  it("still previews the change, with blank areas, when the project's tree cannot be read", async () => {
    // A product root rex cannot parse: the area lookup fails, the preview must not.
    await writeFile(join(rexDir, "product", "index.md"), "---\nnot: [valid\n---\n");
    mockExecResult = {
      stdout: JSON.stringify(previewWith([{ target: CAPABILITY_ID, relation: "touches", score: 12, reasons: [] }])),
      stderr: "", exitCode: 0, error: null,
    };

    const res = await post(port, "/api/rex/smart-add-preview", { text: "Support refunds when paying by card" });

    expect(res.status).toBe(200);
    const { changes } = await res.json();
    expect(changes).toHaveLength(1);
    expect(changes[0].placement.shortlist[0]).toMatchObject({ target: CAPABILITY_ID, strength: "strong", area: "" });
  });

  it("Add & place creates a change outside the Inbox that touches the chosen node", async () => {
    const res = await post(port, "/api/rex/items", {
      title: "Support refunds when paying by card",
      description: "Support refunds when paying by card\n\nBack to the same card.",
      touches: [CAPABILITY_ID],
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.needsPlacement).toBe(false);
    const item = await (await resolveStore(rexDir)).getItem(created.id);
    expect(item).toMatchObject({ type: "change", touches: [CAPABILITY_ID] });
    expect(item).not.toHaveProperty("needsPlacement", true);
    // No rex add spawn: the item route writes through rex's add rule in-process.
    expect(execCalls).toHaveLength(0);
  });

  it("Leave it in the Inbox and Amends… accept through rex add, which reports the change id the panel opens", async () => {
    mockExecResult = { stdout: JSON.stringify(V2_ACCEPTED), stderr: "", exitCode: 0, error: null };

    const res = await post(port, "/api/rex/smart-add-accept", { text: "Support refunds when paying by card" });

    expect(res.status).toBe(200);
    expect((await res.json()).changes).toEqual([expect.objectContaining({ id: V2_ACCEPTED.id, needsPlacement: true })]);
    expect(execCalls[0].args).toContain("--accept");
  });
});
