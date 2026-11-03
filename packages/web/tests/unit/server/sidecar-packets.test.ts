/**
 * Sidecar lens packets: bounded, deterministic, stamped, and honest about
 * what they cut. Fixture trees are rex's own (v2 `v2-tree`, v1 `known-prd`),
 * read through the real model reader; only the git, sourcevision and spawned
 * reads are stubbed.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexTree, loadPrdModel, nodeSpec, specHash } from "../../../src/server/rex-gateway.js";
import type { QueuePlan } from "../../../src/shared/index.js";
import { DESCRIBE_INSTRUCTIONS, DIAGNOSE_RUN_INSTRUCTIONS, GUIDE_INSTRUCTIONS } from "../../../src/server/sidecar/lens-instructions.js";
import { assemblePacket, type PacketSection } from "../../../src/server/sidecar/packet.js";
import {
  buildDescribePacket,
  buildDiagnoseRunPacket,
  buildExplainPacket,
  buildPlanPacket,
  DESCRIBE_CAP,
  DIAGNOSE_RUN_CAP,
  EXPLAIN_CAP,
  GUIDE_CAP,
  PLAN_CAP,
} from "../../../src/server/sidecar/packet-builders.js";
import type { PacketSources, RunGateRead, TaskRunRead } from "../../../src/server/sidecar/packet-sources.js";
import { buildLensPacket, LENS_IDS, LENS_PACKETS } from "../../../src/server/sidecar/lens-packets.js";

const FIXTURES = resolve(__dirname, "../../../../rex/tests/fixtures");
const NOW = "2026-10-28T12:00:00.000Z";
const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE_TASK = "c0000000-0000-4000-8000-000000000002";
const V1_EPIC = "11111111-1111-1111-1111-111111111111";
const V1_TASK = "33333333-3333-3333-3333-333333333333";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sidecar-packets-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function sourcesFor(layout: "v1" | "v2", overrides: Partial<PacketSources> = {}): Promise<PacketSources> {
  const rexDir = join(dir, ".rex");
  mkdirSync(rexDir, { recursive: true });
  cpSync(join(FIXTURES, layout === "v2" ? "v2-tree" : "folder-tree/known-prd"), layout === "v2" ? rexDir : join(rexDir, "prd_tree"), { recursive: true });
  const model = await loadPrdModel(rexDir);
  return {
    sourcePaths: { zones: ".sourcevision/zones.json", runs: ".hench/runs/" },
    prd: async () => ({ layout: model.layout, tree: model.tree }),
    evidence: async () => ({
      commits: [
        { hash: "a".repeat(40), subject: "feat(web): wallet button", timestamp: "2026-10-20T10:00:00.000Z", items: [CHANGE_TASK, V1_TASK], files: ["src/pay/button.ts", "src/pay/wallet.ts"] },
        { hash: "b".repeat(40), subject: "fix(web): safari only", timestamp: "2026-10-22T10:00:00.000Z", items: [CHANGE_TASK], files: ["src/pay/button.ts"] },
      ],
    }),
    zones: async () => ({
      analyzedAt: "2026-10-21T00:00:00.000Z",
      zones: [{ id: "pay", name: "Payments", description: "Card and wallet payment.", cohesion: 0.8, coupling: 0.2, fileCount: 12, matched: 2 }],
      unzoned: 0,
    }),
    zone: async (ref) =>
      ref === "pay"
        ? {
            analyzedAt: "2026-10-21T00:00:00.000Z",
            id: "pay",
            name: "Payments",
            description: "Card and wallet payment.",
            cohesion: 0.8,
            coupling: 0.2,
            fileCount: 12,
            files: ["src/pay/button.ts", "src/pay/wallet.ts"],
            entryPoints: ["src/pay/index.ts"],
            insights: ["Wallet code is shared with refunds."],
          }
        : null,
    resolve: async () => ({
      settings: [
        { key: "vendor", value: "claude", source: "llm.vendor" },
        { key: "model", value: "opus", source: "task.run" },
      ],
      refusals: [{ code: "dirty-tree", message: "The working tree has uncommitted changes." }],
      warnings: [],
    }),
    preview: async () => "# Task brief\nbody\n## Acceptance\nmore\n",
    runs: async () => [
      { id: "11111111-aaaa", status: "completed", startedAt: "2026-10-10T08:00:00.000Z" },
      { id: "22222222-bbbb", status: "failed", startedAt: "2026-10-09T08:00:00.000Z" },
    ],
    taskRun: async () => null,
    diagnose: async () => null,
    queuePlan: async () => null,
    featureEnabled: () => true,
    branchHealth: async () => "this test reads no branch",
    ...overrides,
  };
}

describe("assemblePacket", () => {
  const section = (id: string, lines: number): PacketSection => ({
    id,
    title: id,
    body: Array.from({ length: lines }, (_, i) => `${id} line ${i} ${"x".repeat(40)}`).join("\n"),
    provenance: { source: "test", generatedAt: NOW },
    staleness: { state: "fresh" },
  });

  it("leaves a packet that fits whole and says nothing was cut", () => {
    const packet = assemblePacket({ lens: "t", cap: 5000, header: "# h", sections: [section("a", 3)] });
    expect(packet.cut).toEqual([]);
    expect(packet.text).not.toContain("Cut to fit");
  });

  it("trims the last section first, at a line boundary, and names the cut", () => {
    const packet = assemblePacket({ lens: "t", cap: 1200, header: "# h", sections: [section("a", 5), section("b", 40)] });
    expect(packet.chars).toBeLessThanOrEqual(1200);
    expect(packet.cut.map((c) => c.section)).toEqual(["b"]);
    expect(packet.cut[0]?.kind).toBe("trimmed");
    expect(packet.text).toContain("## Cut to fit");
    expect(packet.text).toContain("- b: trimmed");
    expect(packet.text).toContain("a line 4");
  });

  it("drops a section whole when too little of it would remain", () => {
    const packet = assemblePacket({ lens: "t", cap: 560, header: "# h", sections: [section("a", 5), section("b", 40)] });
    expect(packet.chars).toBeLessThanOrEqual(560);
    expect(packet.cut).toContainEqual(expect.objectContaining({ section: "b", kind: "dropped" }));
    expect(packet.sections.map((s) => s.id)).not.toContain("b");
    expect(packet.text).toContain("- b: left out whole");
  });

  it("is deterministic: the same sections render the same text", () => {
    const input = { lens: "t", cap: 900, header: "# h", sections: [section("a", 5), section("b", 40)] };
    expect(assemblePacket(input).text).toBe(assemblePacket(input).text);
  });

  it("stamps every section with its source, time and staleness", () => {
    const stale: PacketSection = { ...section("s", 1), staleness: { state: "stale", reason: "older than the code" } };
    const text = assemblePacket({ lens: "t", cap: 5000, header: "# h", sections: [stale] }).text;
    expect(text).toContain("_source: test · generated: 2026-10-28T12:00:00.000Z · stale: older than the code_");
  });
});

describe("Explain", () => {
  it("v2: states the capability, its derived status, linked changes, evidence and zone", async () => {
    const packet = await buildExplainPacket(await sourcesFor("v2"), { ref: CAPABILITY }, NOW);
    expect(packet.cap).toBe(EXPLAIN_CAP);
    expect(packet.chars).toBeLessThanOrEqual(EXPLAIN_CAP);
    expect(packet.text).toMatchSnapshot();
  });

  it("v1: states the epic with its acceptance criteria, evidence and zone", async () => {
    const packet = await buildExplainPacket(await sourcesFor("v1"), { ref: V1_EPIC }, NOW);
    expect(packet.text).toMatchSnapshot();
  });

  it("marks the zone section stale when the analysis predates the newest evidence", async () => {
    const packet = await buildExplainPacket(await sourcesFor("v2"), { ref: CAPABILITY }, NOW);
    const zones = packet.sections.find((s) => s.id === "zones");
    expect(zones?.staleness).toEqual({
      state: "stale",
      reason: "analysis 2026-10-21 predates the newest evidence commit 2026-10-22",
    });
    expect(zones?.provenance).toEqual({ source: ".sourcevision/zones.json", generatedAt: "2026-10-21T00:00:00.000Z" });
  });

  it("compares the analysis stamp and commit dates as instants, whatever the author's UTC offset", async () => {
    const commit = (timestamp: string) => ({
      evidence: async () => ({ commits: [{ hash: "c".repeat(40), subject: "s", timestamp, items: [CHANGE_TASK], files: ["src/pay/button.ts"] }] }),
    });
    // 01:00+02:00 is 23:00Z the day before: the analysis at 00:30Z came after it.
    const before = await buildExplainPacket(await sourcesFor("v2", {
      ...commit("2026-10-21T01:00:00+02:00"),
      zones: async () => ({ analyzedAt: "2026-10-21T00:30:00.000Z", zones: [], unzoned: 1 }),
    }), { ref: CAPABILITY }, NOW);
    expect(before.sections.find((s) => s.id === "zones")?.staleness).toEqual({ state: "fresh" });
    // 20:00-05:00 is 01:00Z the next day: the analysis at 00:30Z predates it.
    const after = await buildExplainPacket(await sourcesFor("v2", {
      ...commit("2026-10-20T20:00:00-05:00"),
      zones: async () => ({ analyzedAt: "2026-10-21T00:30:00.000Z", zones: [], unzoned: 1 }),
    }), { ref: CAPABILITY }, NOW);
    expect(after.sections.find((s) => s.id === "zones")?.staleness.state).toBe("stale");
  });

  it("v2: reads evidence for the linked changes and their tasks", async () => {
    const asked: string[][] = [];
    const evidence = async (ids: string[]) => (asked.push(ids), { commits: [] });
    await buildExplainPacket(await sourcesFor("v2", { evidence }), { ref: CAPABILITY }, NOW);
    expect(asked).toEqual([["c0000000-0000-4000-8000-000000000001", CHANGE_TASK]]);
  });

  it("v1: reads evidence for the item's whole subtree", async () => {
    const asked: string[][] = [];
    const evidence = async (ids: string[]) => (asked.push(ids), { commits: [] });
    await buildExplainPacket(await sourcesFor("v1", { evidence }), { ref: V1_EPIC }, NOW);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(expect.arrayContaining([V1_EPIC, "22222222-2222-2222-2222-222222222222", V1_TASK]));
  });

  it("says so, rather than staying silent, when there is no analysis or no git history", async () => {
    const noZones = await buildExplainPacket(await sourcesFor("v2", { zones: async () => null }), { ref: CAPABILITY }, NOW);
    expect(noZones.text).toContain("Not available: no sourcevision analysis");
    const noGit = await buildExplainPacket(await sourcesFor("v2", { evidence: async () => null }), { ref: CAPABILITY }, NOW);
    expect(noGit.text).toContain("Not available: no readable git history");
  });

  it("reports an unresolvable target instead of guessing", async () => {
    const packet = await buildExplainPacket(await sourcesFor("v2"), { ref: "nope" }, NOW);
    expect(packet.text).toContain('"nope" names no product area, capability, zone, epic or feature');
  });

  const AREA = "a0000000-0000-4000-8000-000000000001";

  /** The v2 fixture with the capability met: its spec hash stored as `metAt`. */
  async function metSources(overrides: Partial<PacketSources> = {}): Promise<PacketSources> {
    const sources = await sourcesFor("v2", overrides);
    const prd = (await sources.prd())!;
    const node = indexTree(prd.tree).resolve(CAPABILITY)!;
    node.metAt = specHash(nodeSpec(node));
    return sources;
  }

  it("capability: lists each capability criterion with its label and evidence", async () => {
    // The fixture's open change amends the capability, so it reads changing.
    const changing = await buildExplainPacket(await sourcesFor("v2"), { ref: CAPABILITY }, NOW);
    expect(changing.text).toContain("- c1 [not verified] A valid card is charged once");
    expect(changing.text).toContain("- c2 [not verified] A declined card shows why");
    expect(changing.text).toContain("because an open change is amending it. Evidence: change CH-1 Add Apple Pay: open");

    // With no open change and no `metAt`, nothing has ever satisfied it.
    const sources = await sourcesFor("v2");
    for (const change of (await sources.prd())!.tree.changes) change.status = "deleted";
    const proposed = await buildExplainPacket(sources, { ref: CAPABILITY }, NOW);
    expect(proposed.text).toContain("- c1 [not met] A valid card is charged once");
    expect(proposed.text).toContain("because no applied change has satisfied it yet. Evidence: none on record");
  });

  it("capability: met needs a passing check or an applied change as evidence", async () => {
    const sources = await metSources();
    const node = indexTree((await sources.prd())!.tree).resolve(CAPABILITY)!;
    // Nothing open amends it, and one passing check is on record.
    const open = (await sources.prd())!.tree.changes;
    for (const change of open) change.status = "deleted";
    node.requirements = [{ id: "r1", title: "Charge once", category: "functional", validationType: "automated", acceptanceCriteria: [] }];
    node.checks = [{ requirementId: "r1", result: "pass", at: "2026-10-22T10:00:00.000Z", commit: "abcdef1234567" }];
    const packet = await buildExplainPacket(sources, { ref: CAPABILITY }, NOW);
    expect(packet.text).toContain("- c1 [met] A valid card is charged once");
    expect(packet.text).toContain('check "Charge once": pass on 2026-10-22 at abcdef123');

    node.checks = [];
    const bare = await buildExplainPacket(sources, { ref: CAPABILITY }, NOW);
    expect(bare.text).toContain("- c1 [not verified] A valid card is charged once");
    expect(bare.text).toContain("no passing check or applied change is on record");

    node.checks = [{ requirementId: "r1", result: "fail", at: "2026-10-22T10:00:00.000Z" }];
    const failed = await buildExplainPacket(sources, { ref: CAPABILITY }, NOW);
    expect(failed.text).toContain("- c1 [not met] A valid card is charged once");
    expect(failed.text).toContain('check "Charge once": fail on 2026-10-22');
  });

  it("area: carries the area's capabilities with their derived status", async () => {
    const packet = await buildExplainPacket(await sourcesFor("v2"), { ref: AREA }, NOW);
    expect(packet.text).toContain("Summary: Taking payment for a basket.");
    expect(packet.text).toContain("Capabilities in the area");
    expect(packet.text).toMatch(/- capability A1\.1 Pay by card \(\w+, \w+\)/);
  });

  it("resolves an area or capability by alias, and does not throw on a deleted capability", async () => {
    const sources = await sourcesFor("v2");
    const tree = (await sources.prd())!.tree;
    indexTree(tree).resolve(AREA)!.aliases = ["shop-checkout"];
    const capability = indexTree(tree).resolve(CAPABILITY)!;
    capability.aliases = ["card-pay"];
    expect((await buildExplainPacket(sources, { ref: "shop-checkout" }, NOW)).text).toContain("Capabilities in the area");
    expect((await buildExplainPacket(sources, { ref: "card-pay" }, NOW)).text).toContain("- c1 [not verified] A valid card is charged once");

    capability.status = "deleted";
    const deleted = await buildExplainPacket(sources, { ref: CAPABILITY }, NOW);
    expect(deleted.text).not.toContain("[met]");
  });

  it("zone: carries the zone's summary, metrics, entry points and insights", async () => {
    const packet = await buildExplainPacket(await sourcesFor("v2"), { ref: "pay" }, NOW);
    expect(packet.text).toContain("pay (Payments)");
    expect(packet.text).toContain("Cohesion 0.8, coupling 0.2, 12 files.");
    expect(packet.text).toContain("Summary: Card and wallet payment.");
    expect(packet.text).toContain("- src/pay/index.ts");
    expect(packet.text).toContain("- Wallet code is shared with refunds.");
    expect(packet.text).toContain("_source: .sourcevision/zones.json · generated: 2026-10-21T00:00:00.000Z");
  });

  it("zone: says the analysis is missing when the zone read has nothing", async () => {
    const packet = await buildExplainPacket(await sourcesFor("v2"), { ref: "pay-x" }, NOW);
    expect(packet.text).toContain('"pay-x" names no product area, capability, zone, epic or feature');
  });

  it("v1: says there is no product layer and explains from the PRD and zones", async () => {
    const epic = await buildExplainPacket(await sourcesFor("v1"), { ref: V1_EPIC }, NOW);
    expect(epic.text).toContain("There is no product layer on this tree");
    expect(epic.text).toContain("Done when (acceptance criteria, not capability criteria):");
    expect(epic.text).not.toContain("[met]");
    const zone = await buildExplainPacket(await sourcesFor("v1"), { ref: "pay" }, NOW);
    expect(zone.text).toContain("There is no product layer on this tree");
    expect(zone.text).toContain("pay (Payments)");
  });

  it("instructions require the three labels with evidence, and keep capability criteria apart from done when", async () => {
    const { text } = await buildExplainPacket(await sourcesFor("v2"), { ref: CAPABILITY }, NOW);
    expect(text).toContain("`met`, `not met` or `not verified`");
    expect(text).toContain("cite its evidence");
    expect(text).toContain('"capability criteria" for the standing requirements on the product layer');
    expect(text).toContain('"done when" for a change\'s or task\'s acceptance criteria');
  });

  it("keeps instructions and a long criteria list within the Explain bound, cutting from the end", async () => {
    const sources = await sourcesFor("v2");
    const node = indexTree((await sources.prd())!.tree).resolve(CAPABILITY)!;
    node.criteria = Array.from({ length: 80 }, (_, i) => ({ id: `c${i + 1}`, text: `Criterion ${i + 1} ${"x".repeat(120)}` }));
    const packet = await buildExplainPacket(sources, { ref: CAPABILITY }, NOW);
    expect(packet.chars).toBeLessThanOrEqual(EXPLAIN_CAP);
    expect(packet.text).toContain("## How to explain");
    expect(packet.text).toContain("## Cut to fit");
  });
});

describe("Describe", () => {
  it("v2: carries the task, parents, blockers, resolved settings with sources, brief digest and runs", async () => {
    const packet = await buildDescribePacket(await sourcesFor("v2"), { ref: CHANGE_TASK }, NOW);
    expect(packet.cap).toBe(DESCRIBE_CAP);
    expect(packet.chars).toBeLessThanOrEqual(DESCRIBE_CAP);
    expect(packet.text).toMatchSnapshot();
  });

  it("v1: carries a blocked task with its blocker named", async () => {
    const packet = await buildDescribePacket(await sourcesFor("v1"), { ref: V1_TASK }, NOW);
    expect(packet.text).toMatchSnapshot();
  });

  it("carries done-when as checks, likely files, and the tier with its reason", async () => {
    const sources = await sourcesFor("v2", {
      resolve: async () => ({
        savedTier: "deep",
        settings: [{ key: "model", value: "opus", source: "task.run.tier" }],
        refusals: [],
        warnings: [],
      }),
    });
    const text = (await buildDescribePacket(sources, { ref: CHANGE_TASK }, NOW)).text;
    expect(text).toMatch(/Done when \(checks\):\n- \[ \] /);
    expect(text).toContain("## Likely files");
    expect(text).toContain("- src/pay/button.ts");
    expect(text).toContain("Tier: deep");
    expect(text).toContain('model "opus" comes from task.run.tier');
  });

  it("carries the resolved settings and the dry-run digest from the reads, not a gap", async () => {
    const text = (await buildDescribePacket(await sourcesFor("v2"), { ref: CHANGE_TASK }, NOW)).text;
    expect(text).toContain("model = \"opus\" (from task.run)");
    expect(text).toContain("## Brief preview digest");
    expect(text).toContain("# Task brief");
    expect(text).not.toContain("Not available: the dry run");
  });

  it("starts the resolve and dry-run reads together, before either answers", async () => {
    const started: string[] = [];
    const answers: Record<string, (value: never) => void> = {};
    const sources = await sourcesFor("v2", {
      resolve: () => new Promise((done) => { started.push("resolve"); answers.resolve = done as (v: never) => void; }),
      preview: () => new Promise((done) => { started.push("preview"); answers.preview = done as (v: never) => void; }),
    });
    const building = buildDescribePacket(sources, { ref: CHANGE_TASK }, NOW);
    // Let the builder run until it waits on its reads.
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(started.sort()).toEqual(["preview", "resolve"]);

    answers.resolve!(null as never);
    answers.preview!("# Task brief\n" as never);
    expect((await building).text).toContain("## Brief preview digest");
  });

  it("hands its AbortSignal to both reads", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const sources = await sourcesFor("v2", {
      resolve: async (_id, signal) => { seen.push(signal); return null; },
      preview: async (_id, signal) => { seen.push(signal); return null; },
    });
    const controller = new AbortController();
    await buildDescribePacket(sources, { ref: CHANGE_TASK }, NOW, controller.signal);
    expect(seen).toEqual([controller.signal, controller.signal]);
  });

  it("marks each failed Prepare read unavailable and still builds the packet", async () => {
    const down = await sourcesFor("v2", { resolve: async () => null, preview: async () => null });
    const text = (await buildDescribePacket(down, { ref: CHANGE_TASK }, NOW)).text;
    expect(text).toContain("Not available: the resolve command did not answer");
    expect(text).toContain("Not available: the dry run did not answer");
    expect(text).toContain("## Prior runs");
    expect(text).toContain("## Task");
  });

  it("tells the agent to flag vague done-when and propose tightened ones through a change-set card", async () => {
    const text = (await buildDescribePacket(await sourcesFor("v2"), { ref: CHANGE_TASK }, NOW)).text;
    expect(text).toContain(DESCRIBE_INSTRUCTIONS);
    expect(DESCRIBE_INSTRUCTIONS).toMatch(/flag any that is vague/);
    expect(DESCRIBE_INSTRUCTIONS).toContain("propose_prd_change");
    expect(DESCRIBE_INSTRUCTIONS).toContain("change-set card");
  });

  it("names each refusal and marks an unanswered resolve as unavailable", async () => {
    const ok = await buildDescribePacket(await sourcesFor("v2"), { ref: CHANGE_TASK }, NOW);
    expect(ok.text).toContain("dirty-tree: The working tree has uncommitted changes.");
    const down = await buildDescribePacket(await sourcesFor("v2", { resolve: async () => null }), { ref: CHANGE_TASK }, NOW);
    expect(down.text).toContain("Not available: the resolve command did not answer");
  });
});

/** A failed run of CHANGE_TASK as the Diagnose run read returns it; each fixture overrides what its class rests on. */
function failedRun(overrides: Partial<TaskRunRead> = {}): TaskRunRead {
  return {
    run: {
      id: "run-0001",
      status: "failed",
      startedAt: "2026-10-27T09:00:00.000Z",
      finishedAt: "2026-10-27T09:40:00.000Z",
      error: null,
      path: ".hench/runs/run-0001.json",
    },
    diagnosis: null,
    settings: {},
    gate: { ran: true, passed: true, command: "pnpm test", note: null, textKind: null, text: null, cutChars: 0 },
    review: { path: ".hench/reviews/run-0001.json", summary: "Attacked the wallet button.", unrepaired: [], total: 1 },
    events: {
      path: ".hench/runs/run-0001.events.jsonl",
      last: [
        { at: "2026-10-27T09:38:00.000Z", kind: "gate", summary: "Test gate ran", detail: null },
        { at: "2026-10-27T09:40:00.000Z", kind: "run_finished", summary: "Run finished: failed", detail: null },
      ],
    },
    ...overrides,
  };
}

const FAILED_GATE: RunGateRead = {
  ran: true,
  passed: false,
  command: "node scripts/run-all-tests.mjs affected main",
  note: null,
  textKind: "failure digest",
  text: "FAIL src/pay/button.test.ts > wallet button > renders\nAssertionError: expected 'Pay' to be 'Wallet'\n Test Files  1 failed | 41 passed (42)",
  cutChars: 0,
};

const DIAGNOSE_FIXTURES: Array<[string, Partial<TaskRunRead>]> = [
  ["new test failure", {
    gate: FAILED_GATE,
    diagnosis: {
      class: "test-gate-new",
      summary: "The test gate failed in files this run changed: src/pay/button.test.ts.",
      evidence: ["Gate failure names changed file(s): src/pay/button.test.ts"],
      actions: [
        { kind: "follow-up-run", label: "Follow-up run with the failure digest in the brief" },
        { kind: "re-run", label: "Then re-run the gate" },
      ],
      attempt: { n: 1, of: 2 },
    },
  }],
  ["pre-existing failure", {
    gate: { ...FAILED_GATE, text: "FAIL src/legacy/report.test.ts > totals\n Test Files  1 failed | 41 passed (42)" },
    diagnosis: {
      class: "test-gate-preexisting",
      summary: "The test gate failed only in files this run did not change: src/legacy/report.test.ts.",
      evidence: ["Gate failure names only unchanged file(s): src/legacy/report.test.ts", "Not verified on main"],
      actions: [
        { kind: "verify-on-main", label: "Run the failing tests on main to confirm they fail there" },
        { kind: "close-verified", label: "Then close the task as verified" },
      ],
      attempt: { n: 1, of: 2 },
    },
  }],
  ["review blocked", {
    review: {
      path: ".hench/reviews/run-0001.json",
      summary: "Attacked the wallet button's disabled state.",
      unrepaired: [{ title: "Disabled wallet button still submits", location: "src/pay/button.ts:42", verdict: "must-fix", action: "captured", severity: "high" }],
      total: 3,
    },
    diagnosis: {
      class: "review-blocked",
      summary: "The review left 1 must-fix finding(s) unrepaired.",
      evidence: ["review.unrepairedMustFixCount: 1", "must-fix: Disabled wallet button still submits (src/pay/button.ts:42)"],
      actions: [{ kind: "follow-up-run", label: "Follow-up run with the review findings in the brief" }],
      attempt: { n: 1, of: 2 },
    },
  }],
  ["completion held", {
    diagnosis: {
      class: "completion-held",
      summary: "The agent's completion is held: the run did not finish its gates.",
      evidence: ["completionHold: not-applied"],
      actions: [
        { kind: "fresh", label: `Re-run with a fresh session: ndx work --task=${CHANGE_TASK} --fresh .` },
        { kind: "hand-fix", label: "Or fix it by hand, then verify" },
      ],
      attempt: { n: 1, of: 2 },
    },
  }],
  ["no changes", {
    gate: { ran: false, passed: false, command: null, note: "no files changed", textKind: null, text: null, cutChars: 0 },
    diagnosis: {
      class: "no-changes",
      summary: "The run made no commits.",
      evidence: ["commits: 0"],
      actions: [{ kind: "tighten-done-when", label: "Tighten the task's done-when so the work is concrete" }],
      attempt: { n: 1, of: 2 },
    },
  }],
  ["attempt 2 of 2", {
    gate: FAILED_GATE,
    diagnosis: {
      class: "test-gate-new",
      summary: "The test gate failed in files this run changed: src/pay/button.test.ts.",
      evidence: ["Gate failure names changed file(s): src/pay/button.test.ts"],
      actions: [{ kind: "follow-up-run", label: "Follow-up run with the failure digest in the brief" }],
      attempt: { n: 2, of: 2 },
    },
  }],
];

describe("Diagnose run", () => {
  it.each(DIAGNOSE_FIXTURES)("%s: carries the verdict, gate, review and last events, each with provenance", async (_name, run) => {
    const packet = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun: async () => failedRun(run) }), { ref: CHANGE_TASK }, NOW);
    expect(packet.cap).toBe(DIAGNOSE_RUN_CAP);
    expect(packet.chars).toBeLessThanOrEqual(DIAGNOSE_RUN_CAP);
    expect(packet.sections.map((s) => s.id)).toEqual(["task", "run", "verdict", "gate", "review", "events"]);
    for (const section of packet.sections) expect(section.provenance.source).not.toBe("");
    expect(packet.text).toMatchSnapshot();
  });

  it("reads the attached task's newest run by the task's id", async () => {
    const taskRun = vi.fn(async () => failedRun());
    await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun }), { ref: CHANGE_TASK }, NOW);
    expect(taskRun).toHaveBeenCalledWith(CHANGE_TASK);
  });

  it("lists the actions in the classifier's order, each with the card that carries it out", async () => {
    const [, preexisting] = DIAGNOSE_FIXTURES[1]!;
    const packet = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun: async () => failedRun(preexisting) }), { ref: CHANGE_TASK }, NOW);
    expect(packet.text).toContain("1. [verify-on-main] Run the failing tests on main to confirm they fail there → run_command (command card)");
    expect(packet.text).toContain("2. [close-verified] Then close the task as verified → propose_prd_change (change-set card)");
    const [, held] = DIAGNOSE_FIXTURES[3]!;
    const fresh = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun: async () => failedRun(held) }), { ref: CHANGE_TASK }, NOW);
    expect(fresh.text).toContain("→ start_work with fresh: true (work card)");
  });

  it("states attempt 2 of 2 as the last attempt in the verdict section", async () => {
    const [, last] = DIAGNOSE_FIXTURES[5]!;
    const packet = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun: async () => failedRun(last) }), { ref: CHANGE_TASK }, NOW);
    const verdict = (p: { sections: PacketSection[] }) => p.sections.find((s) => s.id === "verdict")!.body;
    expect(verdict(packet)).toContain("Attempt 2 of 2: next is a fix or a split. Do not offer a re-run or --fresh.");
    const first = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun: async () => failedRun(DIAGNOSE_FIXTURES[0]![1]) }), { ref: CHANGE_TASK }, NOW);
    expect(verdict(first)).not.toContain("next is a fix or a split");
  });

  it("with no run of the task, carries a gap naming hench runs diagnose", async () => {
    const packet = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun: async () => null }), { ref: CHANGE_TASK }, NOW);
    const verdict = packet.sections.find((s) => s.id === "verdict")!;
    expect(verdict.body).toContain("Not available: no run of this task is recorded");
    expect(verdict.body).toContain("hench runs diagnose <run-id>");
    expect(verdict.staleness.state).toBe("unknown");
  });

  it("with an ended run but no recorded verdict, takes the verdict from the spawned command and names it as the source", async () => {
    const [, newTest] = DIAGNOSE_FIXTURES[0]!;
    const verdictOf = newTest.diagnosis!;
    const diagnose = vi.fn(async () => verdictOf);
    const controller = new AbortController();
    const packet = await buildDiagnoseRunPacket(
      await sourcesFor("v2", {
        taskRun: async () => failedRun({ settings: { model: "claude-opus-4-7", review: true, reviewModel: "claude-sonnet-5-5" } }),
        diagnose,
      }),
      { ref: CHANGE_TASK },
      NOW,
      controller.signal,
    );
    expect(diagnose).toHaveBeenCalledWith("run-0001", controller.signal);
    const verdict = packet.sections.find((s) => s.id === "verdict")!;
    expect(verdict.body).toContain("Class: test-gate-new");
    expect(verdict.provenance.source).toBe("`hench runs diagnose run-0001 --format=json`");
    expect(verdict.staleness.state).toBe("fresh");
  });

  it("names the spawned command in a gap when it fails or times out", async () => {
    const packet = await buildDiagnoseRunPacket(
      await sourcesFor("v2", { taskRun: async () => failedRun(), diagnose: async () => null }),
      { ref: CHANGE_TASK },
      NOW,
    );
    const verdict = packet.sections.find((s) => s.id === "verdict")!;
    expect(verdict.body).toContain("`hench runs diagnose run-0001 --format=json` failed or timed out");
    expect(verdict.staleness.state).toBe("unknown");
  });

  it.each(["running", "completed"])("never classifies a %s run", async (status) => {
    const diagnose = vi.fn(async () => DIAGNOSE_FIXTURES[0]![1].diagnosis!);
    const packet = await buildDiagnoseRunPacket(
      await sourcesFor("v2", { taskRun: async () => failedRun({ run: { ...failedRun().run, status } }), diagnose }),
      { ref: CHANGE_TASK },
      NOW,
    );
    expect(diagnose).not.toHaveBeenCalled();
    expect(packet.sections.find((s) => s.id === "verdict")!.body).toMatch(/^Not available: /);
  });

  it("does not spawn when the run already carries its verdict", async () => {
    const diagnose = vi.fn(async () => null);
    await buildDiagnoseRunPacket(
      await sourcesFor("v2", { taskRun: async () => failedRun(DIAGNOSE_FIXTURES[0]![1]), diagnose }),
      { ref: CHANGE_TASK },
      NOW,
    );
    expect(diagnose).not.toHaveBeenCalled();
  });

  it("lists the failed run's settings in the verdict section for start_work, and omits the line when it has none", async () => {
    const [, newTest] = DIAGNOSE_FIXTURES[0]!;
    const settings = { model: "claude-opus-4-7", review: true as const, reviewModel: "claude-sonnet-5-5" };
    const withSettings = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun: async () => failedRun({ ...newTest, settings }) }), { ref: CHANGE_TASK }, NOW);
    const verdict = withSettings.sections.find((s) => s.id === "verdict")!.body;
    expect(verdict).toContain(`options of start_work for a re-run or --fresh: ${JSON.stringify(settings)}`);
    const without = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun: async () => failedRun(newTest) }), { ref: CHANGE_TASK }, NOW);
    expect(without.sections.find((s) => s.id === "verdict")!.body).not.toContain("The failed run's settings");
  });

  it("marks a missing gate, review and event stream as gaps rather than leaving them out", async () => {
    const packet = await buildDiagnoseRunPacket(
      await sourcesFor("v2", { taskRun: async () => failedRun({ gate: null, review: null, events: null }) }),
      { ref: CHANGE_TASK },
      NOW,
    );
    for (const id of ["gate", "review", "events"]) {
      expect(packet.sections.find((s) => s.id === id)!.body).toMatch(/^Not available: /);
    }
  });

  it("reports a ref that names no task instead of reading runs for it", async () => {
    const taskRun = vi.fn(async () => failedRun());
    const packet = await buildDiagnoseRunPacket(await sourcesFor("v2", { taskRun }), { ref: "no-such-task" }, NOW);
    expect(packet.text).toContain('"no-such-task" names no task');
    expect(taskRun).not.toHaveBeenCalled();
  });

  it("instructions require evidence labels with their section, the classifier's order, and a card per action", () => {
    expect(DIAGNOSE_RUN_INSTRUCTIONS).toContain("`tested`, `inspected`, `not met` or `not verified`");
    expect(DIAGNOSE_RUN_INSTRUCTIONS).toContain("name the packet section it rests on");
    expect(DIAGNOSE_RUN_INSTRUCTIONS).toContain("in the order the verdict section lists them");
    expect(DIAGNOSE_RUN_INSTRUCTIONS).toContain("open with \"attempt 2 of 2: next is a fix or a split\" and do not offer a re-run or `--fresh`");
    expect(DIAGNOSE_RUN_INSTRUCTIONS).toMatch(/verify-and-close .*follow-up.*split.*`propose_prd_change`/);
    expect(DIAGNOSE_RUN_INSTRUCTIONS).toMatch(/re-run \(`re-run`\): `start_work`/);
    expect(DIAGNOSE_RUN_INSTRUCTIONS).toMatch(/`--fresh` \(`fresh`\): `start_work` for the task with options `\{ "fresh": true \}`/);
  });

  it("states the PK4 exception for the gate text in the builder, as the start of a digest or the end of a tail", () => {
    const source = readFileSync(resolve(__dirname, "../../../src/server/sidecar/packet-builders.ts"), "utf-8");
    expect(source).toMatch(
      /Knowledge packets omit error text \(PK4\)\. This one deliberately carries the\s+\* gate text, the start of the failure digest \(or the end of the output tail\)/,
    );
  });

  it("says which end of a cut gate text was dropped", async () => {
    const digest = await buildDiagnoseRunPacket(
      await sourcesFor("v2", { taskRun: async () => failedRun({ gate: { ...FAILED_GATE, cutChars: 500 } }) }),
      { ref: CHANGE_TASK },
      NOW,
    );
    expect(digest.text).toContain(`Recorded failure digest, first ${FAILED_GATE.text!.length} characters (500 cut from the end):`);
    const tail = await buildDiagnoseRunPacket(
      await sourcesFor("v2", { taskRun: async () => failedRun({ gate: { ...FAILED_GATE, textKind: "output tail", cutChars: 500 } }) }),
      { ref: CHANGE_TASK },
      NOW,
    );
    expect(tail.text).toContain(`Recorded output tail, last ${FAILED_GATE.text!.length} characters (500 cut from the front):`);
  });

  it("keeps a long gate digest within the cap, cutting the last sections first", async () => {
    const long = { ...FAILED_GATE, text: Array.from({ length: 200 }, (_, i) => `FAIL src/pay/case-${i}.test.ts > case ${i}`).join("\n") };
    const packet = await buildDiagnoseRunPacket(
      await sourcesFor("v2", { taskRun: async () => failedRun({ ...DIAGNOSE_FIXTURES[0]![1], gate: long }) }),
      { ref: CHANGE_TASK },
      NOW,
    );
    expect(packet.chars).toBeLessThanOrEqual(DIAGNOSE_RUN_CAP);
    expect(packet.sections.some((s) => s.id === "verdict")).toBe(true);
    expect(packet.text).toContain("## Cut to fit");
  });
});

describe("Plan", () => {
  it("v2: the product-map slice, placement queue, recent changes and sibling titles", async () => {
    const packet = await buildPlanPacket(await sourcesFor("v2"), { ref: CAPABILITY }, NOW);
    expect(packet.cap).toBe(PLAN_CAP);
    expect(packet.chars).toBeLessThanOrEqual(PLAN_CAP);
    expect(packet.text).toMatchSnapshot();
  });

  it("v1: the epic subtree around the target", async () => {
    const packet = await buildPlanPacket(await sourcesFor("v1"), { ref: V1_TASK }, NOW);
    expect(packet.text).toMatchSnapshot();
  });
});

describe("caps", () => {
  it("cuts an oversized Plan slice to its cap and names the cut", async () => {
    const sources = await sourcesFor("v1");
    const real = await sources.prd();
    if (!real) throw new Error("fixture did not load");
    const epic = real.tree.changes[0]!;
    const many = Array.from({ length: 400 }, (_, i) => ({
      ...epic.children![0]!,
      id: `filler-${i}`,
      title: `Filler feature number ${i} with a title long enough to matter`,
      children: [],
    }));
    const big = { layout: "v1" as const, tree: { product: [], changes: [{ ...epic, children: many }] } };
    const packet = await buildPlanPacket({ ...sources, prd: async () => big }, { ref: V1_EPIC }, NOW);
    expect(packet.chars).toBeLessThanOrEqual(PLAN_CAP);
    expect(packet.cut.length).toBeGreaterThan(0);
    expect(packet.text).toContain("## Cut to fit");
  });
});

describe("lens registry", () => {
  it("builds packets in code that cannot reach a model, a spawn or the network", () => {
    // The packet modules read only through PacketSources; the LLM-client
    // imports allowed are resolveLayout (a path helper) and redactDeep (a
    // pure scrubber) in packet-sources.ts.
    const SIDECAR = resolve(__dirname, "../../../src/server/sidecar");
    for (const file of ["packet.ts", "packet-builders.ts", "branch-packet.ts", "lens-packets.ts", "packet-sources.ts"]) {
      const source = readFileSync(join(SIDECAR, file), "utf-8");
      const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)"/gm)].map((m) => m[0]);
      for (const statement of imports) {
        expect(statement, `${file}: ${statement}`).not.toMatch(/child_process|node:http|node:https|undici|vendor|session|routes-/);
        if (statement.includes("@n-dx/llm-client")) {
          expect(file).toBe("packet-sources.ts");
          expect(statement).toMatch(/^import \{ redactDeep, resolveLayout \} from "@n-dx\/llm-client"$/);
        }
      }
      expect(source, file).not.toMatch(/\bfetch\(/);
    }
  });

  it("Describe reaches the spawned reads only through its injected sources", async () => {
    const resolveRead = vi.fn(async () => null);
    const previewRead = vi.fn(async () => null);
    await buildLensPacket("describe", { ref: CHANGE_TASK }, await sourcesFor("v2", { resolve: resolveRead, preview: previewRead }), NOW);
    expect(resolveRead).toHaveBeenCalledWith(CHANGE_TASK, undefined);
    expect(previewRead).toHaveBeenCalledWith(CHANGE_TASK, undefined);
  });

  it("sends no packet for General and does not read anything", async () => {
    const prd = vi.fn();
    const result = await buildLensPacket("general", {}, { ...(await sourcesFor("v2")), prd }, NOW);
    expect(result).toEqual({ status: "none", lens: "general" });
    expect(prd).not.toHaveBeenCalled();
  });

  it("Diagnose run with no task attached is unavailable, names a task to diagnose, and reads nothing", async () => {
    const prd = vi.fn();
    const taskRun = vi.fn();
    const result = await buildLensPacket("diagnose-run", {}, { ...(await sourcesFor("v2")), prd, taskRun }, NOW);
    expect(result).toEqual({ status: "unavailable", lens: "diagnose-run", needs: "a task to diagnose" });
    expect(prd).not.toHaveBeenCalled();
    expect(taskRun).not.toHaveBeenCalled();
  });

  it("Diagnose run with a task attached builds its own packet", async () => {
    const result = await buildLensPacket("diagnose-run", { ref: CHANGE_TASK }, await sourcesFor("v2"), NOW);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.packet.lens).toBe("diagnose-run");
      expect(result.packet.cap).toBe(DIAGNOSE_RUN_CAP);
    }
  });

  describe("Guide", () => {
    const PLAN: QueuePlan = {
      lanes: [
        {
          command: "ndx work --task=t1 --auto . && ndx work --task=t2 --require-unblocked --auto .",
          changeId: "ch1",
          tasks: [
            { id: "t1", title: "Wire the button", reason: "ready; first in its change" },
            { id: "t2", title: "Style the button", reason: "follows t1 in the same change" },
          ],
        },
      ],
      excluded: [{ id: "t9", title: "Migrate the schema", reason: "tagged migration: runs cold, on its own" }],
      activeRuns: 1,
      runLimit: 3,
      summary: "1 lane from 3 ready tasks.",
    };

    it("is a 6k packet whose body is the planner's plan, read through the injected source", async () => {
      const queuePlan = vi.fn(async () => PLAN);
      const controller = new AbortController();
      const result = await buildLensPacket("guide", {}, await sourcesFor("v2", { queuePlan }), NOW, controller.signal);
      expect(queuePlan).toHaveBeenCalledWith(controller.signal);
      if (result.status !== "ready") throw new Error(`expected a packet, got ${result.status}`);
      const { packet } = result;
      expect(LENS_PACKETS.guide).toMatchObject({ kind: "packet", cap: GUIDE_CAP });
      expect(packet).toMatchObject({ lens: "guide", cap: 6_000, cut: [] });
      expect(packet.chars).toBeLessThanOrEqual(6_000);
      expect(packet.text).toContain("Active runs: 1 of 3");
      expect(packet.text).toContain("1 lane from 3 ready tasks.");
      expect(packet.text).toContain(`Lane 1 (change ch1): ${PLAN.lanes[0].command}`);
      expect(packet.text).toContain("t2 Style the button: follows t1 in the same change");
      expect(packet.text).toContain("t9 Migrate the schema: tagged migration: runs cold, on its own");
      expect(packet.text).toContain(GUIDE_INSTRUCTIONS);
      expect(packet.sections.every((s) => s.provenance.source === "`ndx work --plan-queue --format=json`")).toBe(true);
    });

    it("needs no task: an empty ready list says so, and the instructions forbid a run-plan card", async () => {
      const empty: QueuePlan = { lanes: [], excluded: [], activeRuns: 0, runLimit: 3, summary: "Nothing is ready." };
      const result = await buildLensPacket("guide", {}, await sourcesFor("v2", { queuePlan: async () => empty }), NOW);
      if (result.status !== "ready") throw new Error(`expected a packet, got ${result.status}`);
      expect(result.packet.text).toContain("The ready list is empty: no task is ready to run, so there is no lane to plan and no run-plan card to raise.");
      expect(GUIDE_INSTRUCTIONS).toMatch(/Raise a run-plan card with `propose_run_plan` only when the plan has at least one lane\. With an empty ready list/);
    });

    it("with ready tasks but no lane, says there is nothing to start and lists why each was left out", async () => {
      const none: QueuePlan = { ...PLAN, lanes: [], summary: "Every ready task was left out." };
      const result = await buildLensPacket("guide", {}, await sourcesFor("v2", { queuePlan: async () => none }), NOW);
      if (result.status !== "ready") throw new Error(`expected a packet, got ${result.status}`);
      expect(result.packet.text).toContain("No lane: every ready task was left out. There is nothing to start, so raise no run-plan card.");
      expect(result.packet.text).toContain("t9 Migrate the schema");
    });

    it("marks the plan unavailable, naming the command, when the planner does not answer", async () => {
      const result = await buildLensPacket("guide", {}, await sourcesFor("v2", { queuePlan: async () => null }), NOW);
      if (result.status !== "ready") throw new Error(`expected a packet, got ${result.status}`);
      expect(result.packet.text).toContain("Not available: the planner did not answer. Run `ndx work --plan-queue --format=json` to see why");
    });

    it("while hench.readyNext is off is unavailable, naming it, and builds no packet and spawns no planner", async () => {
      const queuePlan = vi.fn(async () => PLAN);
      const prd = vi.fn();
      const featureEnabled = vi.fn(() => false);
      const result = await buildLensPacket("guide", {}, { ...(await sourcesFor("v2", { queuePlan, featureEnabled })), prd }, NOW);
      expect(result).toEqual({ status: "unavailable", lens: "guide", needs: "the hench.readyNext feature turned on" });
      expect(featureEnabled).toHaveBeenCalledWith("hench.readyNext");
      expect(queuePlan).not.toHaveBeenCalled();
      expect(prd).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["place", "the Inbox list read"],
    ["migrate", "the migration plan reads"],
    ["hub", "a hub session, opened from the hub home"],
  ])("%s reports itself unavailable, naming %s, and reads nothing", async (lens, needs) => {
    const prd = vi.fn();
    const result = await buildLensPacket(lens, {}, { ...(await sourcesFor("v2")), prd }, NOW);
    expect(result).toEqual({ status: "unavailable", lens, needs });
    expect(prd).not.toHaveBeenCalled();
  });

  describe("hub", () => {
    const SNAPSHOT = { text: "Projects: 1 registered, 1 reachable.\n## app (app) · healthy", generatedAt: NOW, changed: [], omitted: 0, commit: () => {} };

    it("is the hub snapshot under the hub instructions, read fresh on each build", async () => {
      const hubSnapshot = vi.fn(async () => SNAPSHOT);
      const sources = { ...(await sourcesFor("v2", { featureEnabled: () => true })), hubSnapshot };
      const first = await buildLensPacket("hub", {}, sources, NOW);
      await buildLensPacket("hub", {}, sources, NOW);
      expect(hubSnapshot).toHaveBeenCalledTimes(2);
      expect(first.status).toBe("ready");
      if (first.status !== "ready") return;
      expect(first.packet.text).toContain("You cannot read files, repositories or transcripts");
      expect(first.packet.text).toContain(SNAPSHOT.text);
      expect(first.packet.cut).toEqual([]);
    });

    it("says why when the snapshot cannot be read, rather than sending an empty one", async () => {
      const sources = { ...(await sourcesFor("v2", { featureEnabled: () => true })), hubSnapshot: async () => "no hub is running" };
      const result = await buildLensPacket("hub", {}, sources, NOW);
      expect(result.status === "ready" && result.packet.text).toContain("Not available: no hub is running");
    });

    it("while the host's web.sidecar is off is unavailable, naming it, and reads no snapshot", async () => {
      const hubSnapshot = vi.fn(async () => SNAPSHOT);
      const featureEnabled = vi.fn(() => false);
      const result = await buildLensPacket("hub", {}, { ...(await sourcesFor("v2", { featureEnabled })), hubSnapshot }, NOW);
      expect(result).toEqual({ status: "unavailable", lens: "hub", needs: "web.sidecar turned on in the project hosting the hub session" });
      expect(featureEnabled).toHaveBeenCalledWith("web.sidecar");
      expect(hubSnapshot).not.toHaveBeenCalled();
    });
  });

  it("treats a lens this build does not know as unavailable, never as another lens", async () => {
    const result = await buildLensPacket("telepathy", {}, await sourcesFor("v2"), NOW);
    expect(result.status).toBe("unavailable");
  });

  it("registers every lens id", () => {
    expect(Object.keys(LENS_PACKETS).sort()).toEqual([...LENS_IDS].sort());
  });
});
