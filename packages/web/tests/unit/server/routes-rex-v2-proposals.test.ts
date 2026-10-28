/**
 * The dashboard's proposal accept routes on a v2 project.
 *
 * Both create what `rex analyze --accept` creates on v2: one change per
 * proposed task, in the Inbox needing placement, with its criteria, tags,
 * priority and source, and an oversized task's proposed subtasks as tasks
 * under it. No v1 epic or feature is written: the change layer has none.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { refreshPRDCache } from "../../../src/server/prd-io.js";
import { itemTypeOf } from "../../../src/shared/index.js";
import { resolveStore, type PRDItem } from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");

/** A pending proposal as `rex analyze` writes it: epic → feature → tasks, one decomposed. */
const PROPOSAL = {
  epic: { title: "Billing", source: "llm", description: "Money in and out." },
  features: [{
    title: "Refunds",
    source: "llm",
    tasks: [
      {
        title: "Refund to the card",
        source: "llm",
        sourceFile: "src/refund.ts",
        description: "Card refunds go back to the card.",
        acceptanceCriteria: ["A refund reaches the card"],
        priority: "high",
        tags: ["billing"],
        decomposition: {
          thresholdWeeks: 2,
          children: [
            { title: "Call the gateway's refund API", source: "llm", sourceFile: "src/refund.ts", acceptanceCriteria: ["The API answers ok"] },
            { title: "Show the refund on the receipt", source: "llm", sourceFile: "src/receipt.ts" },
          ],
        },
      },
      { title: "Email the refund receipt", source: "sourcevision", sourceFile: "src/mail.ts", priority: "low" },
    ],
  }],
};

type Node = PRDItem & { needsPlacement?: boolean; type?: string };

describe("proposal accept routes on a v2 project", () => {
  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v2-proposals-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });
    // As `ndx start` does at boot: the routes read the PRD cache first.
    refreshPRDCache(rexDir, await (await resolveStore(rexDir)).loadDocument());

    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    server = createServer(async (req, res) => {
      const handled = await handleRexRoute(req, res, ctx, () => {});
      if (!handled) {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/rex`;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const send = (path: string, body: unknown) =>
    fetch(`${base}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function roots(): Promise<Node[]> {
    return (await (await resolveStore(rexDir)).loadDocument()).items as Node[];
  }

  /** The changes and tasks the accept made, and that no v1 container appeared. */
  async function expectAcceptedAsChanges(expectedSource: { refund: string; email: string }): Promise<void> {
    const items = await roots();
    expect(items.some((i) => ["Billing", "Refunds"].includes(i.title))).toBe(false);
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);

    const refund = items.find((i) => i.title === "Refund to the card")!;
    expect(refund).toBeDefined();
    expect(itemTypeOf(refund)).toBe("change");
    expect(refund).toMatchObject({
      needsPlacement: true,
      acceptanceCriteria: ["A refund reaches the card"],
      priority: "high",
      source: expectedSource.refund,
    });
    expect(refund.tags).toContain("billing");
    expect((refund.children ?? []).map((c) => [itemTypeOf(c), c.title])).toEqual([
      ["task", "Call the gateway's refund API"],
      ["task", "Show the refund on the receipt"],
    ]);
    expect(refund.children![0].acceptanceCriteria).toEqual(["The API answers ok"]);

    const email = items.find((i) => i.title === "Email the refund receipt")!;
    expect(email).toMatchObject({ needsPlacement: true, priority: "low", source: expectedSource.email });
    expect(itemTypeOf(email)).toBe("change");
  }

  it("POST /proposals/accept lands each proposed task in the Inbox as a change, its subtasks as tasks", async () => {
    writeFileSync(join(rexDir, "pending-proposals.json"), JSON.stringify([PROPOSAL]));

    const res = await send("proposals/accept", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, acceptedCount: 1, addedCount: 4 });

    await expectAcceptedAsChanges({ refund: "llm", email: "sourcevision" });
    expect(JSON.parse(readFileSync(join(rexDir, "pending-proposals.json"), "utf-8"))).toEqual([]);
  });

  it("POST /proposals/accept creates no change for a proposal describing existing code", async () => {
    writeFileSync(join(rexDir, "pending-proposals.json"), JSON.stringify([{
      epic: { title: "Done", source: "llm", status: "completed" },
      features: [{ title: "Already built", source: "llm", status: "completed", tasks: [
        { title: "Card payments work", source: "llm", sourceFile: "src/pay.ts", status: "completed" },
      ] }],
    }]));
    const before = (await roots()).length;

    const res = await send("proposals/accept", {});
    expect(res.status).toBe(200);
    expect((await res.json()).addedCount).toBe(0);
    expect((await roots()).length).toBe(before);
  });

  it("POST /proposals/accept-edited keeps the proposal's source, criteria, tags, priority and subtasks", async () => {
    const edited = {
      epic: { title: PROPOSAL.epic.title, existingId: "not-a-v2-container" },
      features: [{
        title: "Refunds",
        selected: true,
        tasks: [
          { ...PROPOSAL.features[0].tasks[0], selected: true },
          { ...PROPOSAL.features[0].tasks[1], selected: true },
          { title: "Deselected", source: "llm", selected: false },
        ],
      }],
      selected: true,
    };

    const res = await send("proposals/accept-edited", { proposals: [edited] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, acceptedCount: 1, addedCount: 4, changeCount: 2, taskCount: 2 });

    await expectAcceptedAsChanges({ refund: "llm", email: "sourcevision" });
    expect((await roots()).some((i) => i.title === "Deselected")).toBe(false);
  });

  it("POST /proposals/accept-edited falls back to web-proposal-editor when the editor sent no source", async () => {
    const res = await send("proposals/accept-edited", { proposals: [{
      epic: { title: "Billing" },
      features: [{ title: "Refunds", selected: true, tasks: [{ title: "Partial refunds", selected: true }] }],
      selected: true,
    }] });
    expect(res.status).toBe(200);
    const change = (await roots()).find((i) => i.title === "Partial refunds")!;
    expect(change).toMatchObject({ needsPlacement: true, source: "web-proposal-editor" });
  });

  it("POST /proposals/accept-edited with nothing selected writes nothing", async () => {
    const before = (await roots()).length;
    const res = await send("proposals/accept-edited", { proposals: [{
      epic: { title: "Billing" },
      features: [{ title: "Refunds", selected: true, tasks: [{ title: "Off", selected: false }] }],
      selected: true,
    }] });
    expect(res.status).toBe(400);
    expect((await roots()).length).toBe(before);
  });
});
