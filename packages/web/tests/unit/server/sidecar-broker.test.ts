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
  READ_ONLY_COMMAND_PREFIXES,
} from "../../../src/server/sidecar/broker-policy.js";
import { BrokerDecisionError, SidecarBroker, type SidecarCard } from "../../../src/server/sidecar/broker.js";
import type { QueuePlan } from "../../../src/shared/index.js";
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

const PLAN: QueuePlan = {
  lanes: [{ command: "ndx work --task=t1 --auto .", changeId: "c1", tasks: [{ id: "t1", title: "One", reason: "ready" }] }],
  excluded: [],
  activeRuns: 0,
  runLimit: 3,
  summary: "One lane.",
};

/** A sample input for each card-raising tool. */
const SAMPLE: Record<Exclude<BrokerToolName, "ledger_append">, Record<string, unknown>> = {
  run_command: { argv: ["ndx", "status", "."] },
  start_work: { taskId: "t1" },
  propose_prd_change: { items: [{ title: "x" }] },
  propose_run_plan: {},
  place_change_card: { change: "c", target: "cap", relation: "realizes" },
  propose_edit: { path: "a.ts", diff: "-a\n+b" },
  propose_link: { itemId: "t1", ref: "WM-2054" },
  propose_item_edit: { id: "t1", tags: ["ui"] },
  propose_status: { id: "t1", status: "deferred" },
  ask_choice: { question: "Which?", options: [{ label: "A" }, { label: "B" }] },
  github_read: { kind: "pr", ref: "1" },
  draft_github_post: { kind: "comment", target: "1", body: "hi" },
  migration_decision: { entries: [{ id: "x" }] },
  save_draft: { kind: "prompt", path: "p.md", content: "go" },
};

/** Whether a promise is still pending after the microtask queue drains. */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void p.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((r) => setImmediate(r));
  return !settled;
}

describe("allow-listability", () => {
  const NEVER = ["start_work", "propose_prd_change", "propose_run_plan", "place_change_card", "propose_edit", "propose_link", "propose_item_edit", "propose_status", "ask_choice", "draft_github_post", "migration_decision", "save_draft"] as const;

  it("never allow-lists work, edits, PRD writes, placements, links, migration decisions or posts", () => {
    for (const tool of NEVER) {
      expect(BROKER_TOOL_POLICY[tool].allowList).toBe("never");
      expect(allowListKey(tool, SAMPLE[tool])).toBeNull();
    }
  });

  it("allow-lists a command by its exact argv and nothing else; GitHub reads are allowed per project, never on the list", () => {
    expect(allowListKey("run_command", { argv: ["ndx", "status", "."] })).toBe('["ndx","status","."]');
    expect(allowListKey("github_read", SAMPLE.github_read)).toBeNull();
    expect(BROKER_TOOL_POLICY.github_read.allowList).toBe("per-project");
    const listable = BROKER_TOOL_NAMES.filter((t) => BROKER_TOOL_POLICY[t].allowList === "per-call");
    expect(listable).toEqual(["run_command"]);
  });

  it("allow-lists a command only when its argv begins with a read-only prefix", () => {
    for (const argv of [
      ["ndx", "status"], ["ndx", "status", "--format=json", "."], ["ndx", "usage", "."],
      ["git", "status"], ["git", "log", "--oneline", "-5"], ["git", "diff", "main"], ["git", "show", "HEAD"],
    ]) {
      expect(allowListKey("run_command", { argv })).toBe(JSON.stringify(argv));
    }
    expect(READ_ONLY_COMMAND_PREFIXES.map((p) => p.join(" ")))
      .toEqual(expect.arrayContaining(["ndx status", "ndx usage", "git status", "git log", "git diff", "git show"]));
  });

  it("never allow-lists a command off the read-only list", () => {
    for (const argv of [
      // #901 F2: each of these slipped past the old work/reset/push word list.
      ["ndx", "hench", "run", "--task=abc", "."], ["ndx", "self-heal", "."], ["ndx", "rex", "add", "task", "x", "."],
      ["git", "clean", "-fdx"], ["ndx", "work", "."], ["git", "push"], ["ndx", "analyze", "."],
      ["git", "reset", "--hard"],
      // A read-only word that is not the prefix, or a prefix reached through a wrapper or global option.
      ["ndx", "plan", "status"], ["sh", "-c", "git status"], ["git", "-C", "..", "status"], ["npx", "ndx", "status"],
      // git writes a file through --output.
      ["git", "diff", "--output=patch.diff"], ["git", "log", "--output", "log.txt"],
      ["ndx"], ["git"],
    ]) {
      expect(allowListKey("run_command", { argv })).toBeNull();
    }
  });
});

describe("cards", () => {
  it("each write tool waits on its card until the operator decides it", async () => {
    for (const tool of Object.keys(SAMPLE) as Array<keyof typeof SAMPLE>) {
      const call = broker.request("s1", tool, SAMPLE[tool], undefined, tool === "propose_run_plan" ? { runPlan: PLAN } : {});
      expect(await isPending(call)).toBe(true);
      const card = raised.at(-1)!;
      expect(card).toMatchObject({ tool, kind: BROKER_TOOL_POLICY[tool].card, status: "pending" });
      // A run plan is approved by choosing a lane.
      broker.decide("s1", card.id, { approve: tool !== "propose_edit", ...(tool === "propose_run_plan" && { lane: 0 }) });
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

  it("ignores allow-list rules for tools that are not allow-listed per call, and unsafe commands written into the file", async () => {
    writeFileSync(join(dir, "allow-list.json"), JSON.stringify({
      schema: "ndx/sidecar-allow-list/v1",
      rules: [
        { tool: "start_work", key: "*" },
        { tool: "draft_github_post", key: "*" },
        { tool: "run_command", key: '["ndx","work","."]' },
        // A rule from before GitHub reads moved to web.sidecarGithubReads.
        { tool: "github_read", key: "*" },
        { tool: "run_command", key: '["ndx","status","."]' },
      ],
    }));
    expect(broker.allowList()).toEqual([{ tool: "run_command", key: '["ndx","status","."]' }]);
    expect(await isPending(broker.request("s1", "start_work", SAMPLE.start_work))).toBe(true);
    expect(await isPending(broker.request("s2", "run_command", { argv: ["ndx", "work", "."] }))).toBe(true);
    expect(await isPending(broker.request("s3", "github_read", SAMPLE.github_read))).toBe(true);
  });

  it("drops a remembered command off the read-only list when the allow-list is read", async () => {
    // Rules the old deny list let an operator remember (#901 F2).
    writeFileSync(join(dir, "allow-list.json"), JSON.stringify({
      schema: "ndx/sidecar-allow-list/v1",
      rules: [
        { tool: "run_command", key: '["ndx","hench","run","--task=abc","."]' },
        { tool: "run_command", key: '["git","clean","-fdx"]' },
        { tool: "run_command", key: '["ndx","status","."]' },
      ],
    }));
    expect(broker.allowList()).toEqual([{ tool: "run_command", key: '["ndx","status","."]' }]);
    expect(await isPending(broker.request("s1", "run_command", { argv: ["git", "clean", "-fdx"] }))).toBe(true);
    expect(await broker.request("s2", "run_command", { argv: ["ndx", "status", "."] }))
      .toEqual({ approved: true, decidedBy: "allow-list" });
  });

  it("refuses to remember a command off the read-only list", async () => {
    const call = broker.request("s1", "run_command", { argv: ["ndx", "self-heal", "."] });
    expect(() => broker.decide("s1", raised[0].id, { approve: true, remember: true })).toThrow(BrokerDecisionError);
    expect(broker.allowList()).toEqual([]);
    expect(await isPending(call)).toBe(true);
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

describe("run-plan proposals", () => {
  const raise = () => broker.request("s1", "propose_run_plan", { note: "two ready lanes" }, undefined, { runPlan: PLAN });

  it("keeps the planner's plan on the card, and can never be allow-listed or remembered", async () => {
    const call = raise();
    const card = raised[0];
    expect(card).toMatchObject({ kind: "run-plan", allowListKey: null, runPlan: PLAN });
    expect(() => broker.checkAllow("propose_run_plan", {})).toThrow(BrokerDecisionError);
    expect(() => broker.decide("s1", card.id, { approve: true, lane: 0, remember: true })).toThrow(/can never be allow-listed/);
    expect(await isPending(call)).toBe(true);
  });

  it("ignores an allow-list rule for the tool written into the file", async () => {
    writeFileSync(join(dir, "allow-list.json"), JSON.stringify({ schema: "ndx/sidecar-allow-list/v1", rules: [{ tool: "propose_run_plan", key: "*" }] }));
    expect(broker.allowList()).toEqual([]);
    expect(await isPending(raise())).toBe(true);
  });

  it("is approved by choosing a lane of the plan, and records it", async () => {
    const call = raise();
    const card = raised[0];
    expect(() => broker.decide("s1", card.id, { approve: true })).toThrow(/choosing a lane/);
    expect(() => broker.decide("s1", card.id, { approve: true, lane: 1 })).toThrow(/must be a lane of the plan \(0 to 0\)/);
    expect(() => broker.decide("s1", card.id, { approve: true, lane: 0.5 })).toThrow(BrokerDecisionError);
    expect(() => broker.decide("s1", card.id, { approve: false, lane: 0 })).toThrow(/Only an approval chooses a lane/);
    expect(await isPending(call)).toBe(true);

    expect(broker.decide("s1", card.id, { approve: true, lane: 0 })).toMatchObject({ status: "approved", lane: 0 });
    expect(await call).toMatchObject({ approved: true, decidedBy: "operator", card: { lane: 0 } });
  });

  it("is denied, Not now, without a lane", async () => {
    const call = raise();
    broker.decide("s1", raised[0].id, { approve: false });
    expect(await call).toMatchObject({ approved: false, decidedBy: "operator" });
  });

  it("takes no lane on any other card", async () => {
    void broker.request("s1", "start_work", { taskId: "t1" });
    expect(() => broker.decide("s1", raised[0].id, { approve: true, lane: 0 })).toThrow(/A work card takes no lane/);
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
