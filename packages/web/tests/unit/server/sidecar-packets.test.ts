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
import { DESCRIBE_INSTRUCTIONS } from "../../../src/server/sidecar/lens-instructions.js";
import { assemblePacket, type PacketSection } from "../../../src/server/sidecar/packet.js";
import {
  buildDescribePacket,
  buildExplainPacket,
  buildPlanPacket,
  DESCRIBE_CAP,
  EXPLAIN_CAP,
  PLAN_CAP,
} from "../../../src/server/sidecar/packet-builders.js";
import type { PacketSources } from "../../../src/server/sidecar/packet-sources.js";
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
    // The packet modules read only through PacketSources; the one LLM-client
    // import allowed is resolveLayout (a path helper) in packet-sources.ts.
    const SIDECAR = resolve(__dirname, "../../../src/server/sidecar");
    for (const file of ["packet.ts", "packet-builders.ts", "lens-packets.ts", "packet-sources.ts"]) {
      const source = readFileSync(join(SIDECAR, file), "utf-8");
      const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)"/gm)].map((m) => m[0]);
      for (const statement of imports) {
        expect(statement, `${file}: ${statement}`).not.toMatch(/child_process|node:http|node:https|undici|vendor|session|routes-/);
        if (statement.includes("@n-dx/llm-client")) {
          expect(file).toBe("packet-sources.ts");
          expect(statement).toMatch(/^import \{ resolveLayout \} from "@n-dx\/llm-client"$/);
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

  it.each([
    ["guide", "the queue planner"],
    ["diagnose-run", "the run classifier"],
    ["diagnose-branch", "the branch status collector"],
    ["place", "the Inbox list read"],
    ["migrate", "the migration plan reads"],
    ["hub", "the hub snapshot"],
  ])("%s reports itself unavailable, naming %s, and reads nothing", async (lens, needs) => {
    const prd = vi.fn();
    const result = await buildLensPacket(lens, {}, { ...(await sourcesFor("v2")), prd }, NOW);
    expect(result).toEqual({ status: "unavailable", lens, needs });
    expect(prd).not.toHaveBeenCalled();
  });

  it("treats a lens this build does not know as unavailable, never as another lens", async () => {
    const result = await buildLensPacket("telepathy", {}, await sourcesFor("v2"), NOW);
    expect(result.status).toBe("unavailable");
  });

  it("registers every lens id", () => {
    expect(Object.keys(LENS_PACKETS).sort()).toEqual([...LENS_IDS].sort());
  });
});
