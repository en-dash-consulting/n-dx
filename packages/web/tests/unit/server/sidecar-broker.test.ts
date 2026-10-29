/**
 * The ndx-sidecar broker: a write tool waits on its card unless the Sidecar
 * allow-list covers the call, and work, edits, PRD writes, placements,
 * migration decisions and posts can never be allow-listed.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowListKey,
  BROKER_TOOL_NAMES,
  BROKER_TOOL_POLICY,
  type BrokerToolName,
} from "../../../src/server/sidecar/broker-policy.js";
import { BrokerDecisionError, SidecarBroker, type SidecarCard } from "../../../src/server/sidecar/broker.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let dir: string;
let raised: SidecarCard[];
let broker: SidecarBroker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sidecar-broker-"));
  raised = [];
  broker = new SidecarBroker({ dir, onCard: (card) => { if (card.status === "pending") raised.push(card); } });
});

afterEach(async () => {
  await removeTestDir(dir);
});

/** A sample input for each card-raising tool. */
const SAMPLE: Record<Exclude<BrokerToolName, "ledger_append">, Record<string, unknown>> = {
  run_command: { argv: ["ndx", "status", "."] },
  start_work: { taskId: "t1" },
  propose_prd_change: { items: [{ title: "x" }] },
  place_change_card: { change: "c", target: "cap", relation: "realizes" },
  propose_edit: { path: "a.ts", diff: "-a\n+b" },
  github_read: { kind: "pr", ref: "1" },
  draft_github_post: { kind: "comment", target: "1", body: "hi" },
  migration_decision: { entries: [{ id: "x" }] },
};

/** Whether a promise is still pending after the microtask queue drains. */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void p.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((r) => setImmediate(r));
  return !settled;
}

describe("allow-listability", () => {
  const NEVER = ["start_work", "propose_prd_change", "place_change_card", "propose_edit", "draft_github_post", "migration_decision"] as const;

  it("never allow-lists work, edits, PRD writes, placements, migration decisions or posts", () => {
    for (const tool of NEVER) {
      expect(BROKER_TOOL_POLICY[tool].allowList).toBe("never");
      expect(allowListKey(tool, SAMPLE[tool])).toBeNull();
    }
  });

  it("allow-lists a command by its exact argv, GitHub reads per tool, and every other tool never", () => {
    expect(allowListKey("run_command", { argv: ["ndx", "status", "."] })).toBe('["ndx","status","."]');
    expect(allowListKey("github_read", SAMPLE.github_read)).toBe("*");
    const listable = BROKER_TOOL_NAMES.filter((t) => BROKER_TOOL_POLICY[t].allowList !== "never");
    expect(listable.sort()).toEqual(["github_read", "run_command"]);
  });

  it("never allow-lists a command that works, resets or pushes", () => {
    for (const argv of [
      ["ndx", "work", "."], ["git", "reset", "--hard"], ["git", "push"], ["ndx", "ship", "--push=origin"],
      // Wrapped in a shell string, the words are inside one token.
      ["sh", "-c", "ndx work ."], ["bash", "-lc", "git fetch && git push origin HEAD"], ["cmd", "/c", "git reset --hard"],
    ]) {
      expect(allowListKey("run_command", { argv })).toBeNull();
    }
  });
});

describe("cards", () => {
  it("each write tool waits on its card until the operator decides it", async () => {
    for (const tool of Object.keys(SAMPLE) as Array<keyof typeof SAMPLE>) {
      const call = broker.request("s1", tool, SAMPLE[tool]);
      expect(await isPending(call)).toBe(true);
      const card = raised.at(-1)!;
      expect(card).toMatchObject({ tool, kind: BROKER_TOOL_POLICY[tool].card, status: "pending" });
      broker.decide("s1", card.id, { approve: tool !== "propose_edit" });
      expect(await call).toMatchObject({ approved: tool !== "propose_edit", decidedBy: "operator" });
    }
    const audit = readFileSync(join(dir, "s1.cards.jsonl"), "utf-8").trim().split("\n");
    expect(audit).toHaveLength(Object.keys(SAMPLE).length);
  });

  it("settles an allow-listed call at once and raises no card", async () => {
    const first = broker.request("s1", "run_command", { argv: ["ndx", "status", "."] });
    expect(broker.decide("s1", raised[0].id, { approve: true, remember: true }).remembered).toBe(true);
    await first;
    expect(broker.cards("s1")[0]).toMatchObject({ status: "approved", remembered: true });
    expect(await broker.request("s1", "run_command", { argv: ["ndx", "status", "."] }))
      .toEqual({ approved: true, decidedBy: "allow-list" });
    expect(raised).toHaveLength(1);
    // A different command still asks.
    expect(await isPending(broker.request("s1", "run_command", { argv: ["ndx", "status", "--json"] }))).toBe(true);
  });

  it("refuses to remember a call that can never be allow-listed, and leaves the card pending", async () => {
    const call = broker.request("s1", "start_work", SAMPLE.start_work);
    expect(() => broker.decide("s1", raised[0].id, { approve: true, remember: true })).toThrow(BrokerDecisionError);
    expect(broker.allowList()).toEqual([]);
    expect(await isPending(call)).toBe(true);
  });

  it("ignores allow-list rules for never-allow-listed tools and unsafe commands written into the file", async () => {
    writeFileSync(join(dir, "allow-list.json"), JSON.stringify({
      schema: "ndx/sidecar-allow-list/v1",
      rules: [
        { tool: "start_work", key: "*" },
        { tool: "draft_github_post", key: "*" },
        { tool: "run_command", key: '["ndx","work","."]' },
        { tool: "github_read", key: "*" },
      ],
    }));
    expect(broker.allowList()).toEqual([{ tool: "github_read", key: "*" }]);
    expect(await isPending(broker.request("s1", "start_work", SAMPLE.start_work))).toBe(true);
    expect(await isPending(broker.request("s2", "run_command", { argv: ["ndx", "work", "."] }))).toBe(true);
    expect(await broker.request("s3", "github_read", SAMPLE.github_read)).toEqual({ approved: true, decidedBy: "allow-list" });
  });

  it("decides cards in order", async () => {
    void broker.request("s1", "start_work", SAMPLE.start_work);
    void broker.request("s1", "propose_edit", SAMPLE.propose_edit);
    expect(() => broker.decide("s1", raised[1].id, { approve: true })).toThrow(/decided in order/);
    broker.decide("s1", raised[0].id, { approve: false, reason: "not now" });
    expect(broker.decide("s1", raised[1].id, { approve: true }).status).toBe("approved");
    expect(() => broker.decide("s1", raised[1].id, { approve: true })).toThrow(/already settled/);
    expect(() => broker.decide("s2", raised[0].id, { approve: true })).toThrow(/No card/);
  });

  it("withdraws pending cards when the turn stops or the call is aborted", async () => {
    const stopped = broker.request("s1", "start_work", SAMPLE.start_work);
    expect(broker.withdraw("s1", "The operator stopped the turn")).toBe(1);
    expect(await stopped).toMatchObject({ approved: false, decidedBy: "withdrawn" });

    const abort = new AbortController();
    const aborted = broker.request("s1", "propose_edit", SAMPLE.propose_edit, abort.signal);
    abort.abort();
    expect(await aborted).toMatchObject({ approved: false, decidedBy: "withdrawn" });
    expect(broker.cards("s1").map((c) => c.status)).toEqual(["withdrawn", "withdrawn"]);
  });
});

describe("change-set proposals", () => {
  const changeSet = { layout: "v1" as const, items: [{ title: "x", type: "epic" }] };

  it("keeps an approved change-set card a proposal until its write is recorded, so its ghost rows stay until the items exist", async () => {
    const call = broker.request("s1", "propose_prd_change", SAMPLE.propose_prd_change, undefined, { changeSet });
    const [card] = raised;
    expect(broker.proposals().map((c) => c.id)).toEqual([card.id]);

    broker.decide("s1", card.id, { approve: true });
    await call;
    expect(broker.proposals().map((c) => c.id)).toEqual([card.id]);

    broker.recordCarriedOut("s1", card.id, { ok: true, ids: ["n1"] });
    expect(broker.proposals()).toEqual([]);
    expect(broker.cards("s1")[0].carriedOut).toEqual({ ok: true, ids: ["n1"] });
  });

  it("drops a denied change-set card at once, and records no write for it", async () => {
    const call = broker.request("s1", "propose_prd_change", SAMPLE.propose_prd_change, undefined, { changeSet });
    const [card] = raised;
    broker.decide("s1", card.id, { approve: false });
    await call;
    expect(broker.proposals()).toEqual([]);
    broker.recordCarriedOut("s1", card.id, { ok: true, ids: ["n1"] });
    expect(broker.cards("s1")[0].carriedOut).toBeUndefined();
  });

  it("refuses edits on a card with no change set, before remembering anything", async () => {
    void broker.request("s1", "run_command", SAMPLE.run_command);
    const [card] = raised;
    expect(() => broker.decide("s1", card.id, { approve: true, remember: true, edits: [] })).toThrow(BrokerDecisionError);
    expect(broker.allowList()).toEqual([]);
    expect(broker.cards("s1")[0].status).toBe("pending");
  });
});

describe("ledger", () => {
  it("appends typed, bounded entries without a card", () => {
    broker.appendLedger("s1", "gotcha", "the cache is per worktree");
    expect(readFileSync(join(dir, "s1.ledger.jsonl"), "utf-8")).toContain('"type":"gotcha"');
    expect(() => broker.appendLedger("s1", "verified", "x".repeat(241))).toThrow(/at most 240/);
    expect(raised).toEqual([]);
  });
});
