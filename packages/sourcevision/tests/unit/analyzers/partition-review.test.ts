import { describe, it, expect, vi } from "vitest";
import {
  assessPartitionHealth,
  buildPartitionMapRequest,
  formatPartitionLine,
  reviewPreviousPartition,
} from "../../../src/analyzers/partition-review.js";
import { analyzeZones, computeStructureHash } from "../../../src/analyzers/zones.js";
import { snapshotRunLedger, startRunLedger } from "../../../src/analyzers/run-ledger.js";
import { validateModule } from "../../../src/schema/index.js";
import type { Zone, Zones } from "../../../src/schema/index.js";
import { makeEdge, makeFileEntry, makeImports, makeInventory, makeZone } from "./zones-helpers.js";

/** `count` zones; the first `small` hold one file, the rest four. */
function zonesOf(count: number, small: number, idFor = (i: number) => `zone-${String.fromCharCode(97 + i)}`): Zone[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i < small ? 1 : 4;
    return makeZone(idFor(i), Array.from({ length: n }, (_, j) => `src/z${i}/f${j}.ts`));
  });
}

describe("assessPartitionHealth", () => {
  it("is healthy below the minimum zone count however fragmented", () => {
    const h = assessPartitionHealth(zonesOf(6, 6));
    expect(h.verdict).toBe("healthy");
    expect(h.smallZones).toBe(6);
  });

  it("is fragmented when at least 40% of zones hold two files or fewer", () => {
    const h = assessPartitionHealth(zonesOf(10, 4));
    expect(h.verdict).toBe("fragmented");
    expect(h.smallShare).toBe(0.4);
    expect(h.reasons?.[0]).toContain("4/10");
  });

  it("is borderline between 20% and 40% small zones", () => {
    expect(assessPartitionHealth(zonesOf(10, 2)).verdict).toBe("borderline");
    expect(assessPartitionHealth(zonesOf(10, 1)).verdict).toBe("healthy");
  });

  it("is borderline when a quarter of ids carry a numeric suffix", () => {
    const h = assessPartitionHealth(zonesOf(8, 0, (i) => (i < 2 ? `routes-${i + 2}` : `zone-${String.fromCharCode(97 + i)}`)));
    expect(h.verdict).toBe("borderline");
    expect(h.numericIds).toBe(2);
  });
});

describe("reviewPreviousPartition", () => {
  it("rejects a fragmented partition without asking Jev", async () => {
    const judge = vi.fn();
    const d = await reviewPreviousPartition({ zones: zonesOf(10, 5) }, "fp1", { judge });
    expect(d).toMatchObject({ trustPrevious: false, fresh: true, review: { fingerprint: "fp1", rejected: true } });
    expect(judge).not.toHaveBeenCalled();
  });

  it("trusts a healthy partition without asking Jev", async () => {
    const judge = vi.fn();
    const d = await reviewPreviousPartition({ zones: zonesOf(10, 0) }, "fp1", { judge });
    expect(d.trustPrevious).toBe(true);
    expect(d.review.rejected).toBe(false);
    expect(judge).not.toHaveBeenCalled();
  });

  it("asks Jev in the borderline band and rejects at or below 0.3", async () => {
    const judge = vi.fn().mockResolvedValue(0.2);
    const d = await reviewPreviousPartition({ zones: zonesOf(10, 3) }, "fp1", { judge });
    expect(judge).toHaveBeenCalledOnce();
    expect(d.trustPrevious).toBe(false);
    expect(d.review.mapProbability).toBe(0.2);
  });

  it("keeps a borderline partition Jev finds sensible or cannot judge", async () => {
    for (const p of [0.5, undefined]) {
      const d = await reviewPreviousPartition({ zones: zonesOf(10, 3) }, "fp1", { judge: vi.fn().mockResolvedValue(p) });
      expect(d.trustPrevious).toBe(true);
      expect(d.review.rejected).toBe(false);
    }
  });

  it("does not reject twice for the same inputFingerprint", async () => {
    const judge = vi.fn();
    const prior = { fingerprint: "fp1", rejected: true, health: assessPartitionHealth(zonesOf(10, 5)) };
    const d = await reviewPreviousPartition({ zones: zonesOf(10, 5), partitionReview: prior }, "fp1", { judge });
    expect(d).toEqual({ trustPrevious: true, fresh: false, review: prior });
  });

  it("reviews again once the fingerprint changes", async () => {
    const prior = { fingerprint: "fp1", rejected: true, health: assessPartitionHealth(zonesOf(10, 5)) };
    const d = await reviewPreviousPartition({ zones: zonesOf(10, 5), partitionReview: prior }, "fp2");
    expect(d).toMatchObject({ trustPrevious: false, fresh: true, review: { fingerprint: "fp2" } });
  });
});

describe("buildPartitionMapRequest", () => {
  it("sends file groupings, not names or descriptions", () => {
    const zones = [makeZone("routes-3", ["app/routes/a.tsx"], { name: "Scrapbook Application", description: "A scrapbook" })];
    const { state, questions } = buildPartitionMapRequest(zones, []);
    const text = JSON.stringify(state);
    expect(text).toContain("app/routes/a.tsx");
    expect(text).not.toContain("Scrapbook");
    expect(text).not.toContain("routes-3");
    expect(questions.map.type).toBe("noul");
  });
});

describe("formatPartitionLine", () => {
  it("says nothing for a healthy kept partition", () => {
    expect(formatPartitionLine({ fingerprint: "f", rejected: false, health: assessPartitionHealth(zonesOf(10, 0)) })).toBeUndefined();
  });

  it("names the reason and the result of a re-partition", () => {
    const line = formatPartitionLine({
      fingerprint: "f",
      rejected: true,
      health: assessPartitionHealth(zonesOf(10, 5)),
      after: assessPartitionHealth(zonesOf(4, 0)),
    });
    expect(line).toContain("[partition]");
    expect(line).toContain("5/10");
    expect(line).toContain("4 zones, 0 small");
  });
});

describe("analyzeZones partition review", () => {
  // Four feature directories of five tightly-connected files each.
  const features = ["alpha", "beta", "gamma", "delta"];
  const files = features.flatMap((f) => Array.from({ length: 5 }, (_, i) => `src/${f}/m${i}.ts`));
  const inventory = makeInventory(files.map((p) => makeFileEntry(p)));
  const imports = makeImports(
    features.flatMap((f) =>
      Array.from({ length: 5 }, (_, i) => makeEdge(`src/${f}/m${i}.ts`, `src/${f}/m${(i + 1) % 5}.ts`)),
    ),
  );

  /** A previous run's zones with the same inputs, shattered into 1–2 file fragments. */
  async function fragmentedPrevious(): Promise<Zones> {
    const { zones: fresh } = await analyzeZones(inventory, imports, { enrich: false });
    const shards: Zone[] = [];
    for (const f of features) {
      const group = files.filter((p) => p.startsWith(`src/${f}/`));
      // A three-file shard overlaps the real five-file zone by 0.6 — enough to
      // inherit identity at the default threshold, not after a rejection.
      shards.push(makeZone(`${f}-2`, group.slice(0, 3)), makeZone(`${f}-3`, group.slice(3)));
    }
    return { ...fresh, zones: shards, structureHash: computeStructureHash(shards), partitionReview: undefined };
  }

  it("re-partitions a fragmented previous partition even when inputs are unchanged", async () => {
    const previousZones = await fragmentedPrevious();
    const result = await analyzeZones(inventory, imports, { enrich: false, previousZones });
    expect(result.structureChanged).toBe(true);
    expect(result.zones.partitionReview).toMatchObject({ rejected: true, fingerprint: previousZones.inputFingerprint });
    expect(result.zones.partitionReview?.after?.smallZones).toBe(0);
    expect(result.zones.zones.every((z) => z.files.length > 2)).toBe(true);
  });

  it("records the review in the run ledger and zones.json validates", async () => {
    startRunLedger("fast");
    const result = await analyzeZones(inventory, imports, { enrich: false, previousZones: await fragmentedPrevious() });
    expect(snapshotRunLedger().partition).toMatchObject({ rejected: true, reused: false, after: { smallZones: 0 } });
    expect(validateModule("zones", result.zones).ok).toBe(true);
  });

  it("does not hand a fragment's identity to a zone that only half matches it", async () => {
    const previousZones = await fragmentedPrevious();
    const result = await analyzeZones(inventory, imports, { enrich: false, previousZones });
    const ids = result.zones.zones.map((z) => z.id);
    expect(ids.some((id) => /-\d+$/.test(id))).toBe(false);
  });

  it("reuses the re-partitioned result on the next run", async () => {
    const first = await analyzeZones(inventory, imports, { enrich: false, previousZones: await fragmentedPrevious() });
    const second = await analyzeZones(inventory, imports, { enrich: false, previousZones: first.zones });
    expect(second.structureChanged).toBe(false);
    expect(second.zones.partitionReview).toEqual(first.zones.partitionReview);
  });

  it("keeps an explicit reuseStructure request", async () => {
    const previousZones = await fragmentedPrevious();
    const result = await analyzeZones(inventory, imports, { enrich: false, previousZones, reuseStructure: true });
    expect(result.structureChanged).toBe(false);
    expect(result.zones.zones).toHaveLength(8);
  });
});
