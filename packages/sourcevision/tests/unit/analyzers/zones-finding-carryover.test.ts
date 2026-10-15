import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    callClaude: vi.fn(),
    getJudgmentRoute: vi.fn(() => undefined),
    ClaudeClientError: actual.ClaudeClientError,
    setClaudeConfig: vi.fn(),
    getAuthMode: vi.fn(),
    DEFAULT_MODEL: "claude-sonnet-4-6",
    resolveLightModel: vi.fn(() => "claude-haiku-4-5"),
  };
});

import { callClaude } from "../../../src/analyzers/claude-client.js";
import { analyzeZones, computeZoneContentHash } from "../../../src/analyzers/zones.js";
import type { Zones } from "../../../src/schema/index.js";
import { makeEdge, makeFileEntry, makeImports, makeInventory } from "./zones-helpers.js";

/**
 * #743 retest: after `--target-pass=4`, findings from passes 1–3 were gone and
 * only pass 0 and pass 4 remained. Content hashes were re-keyed to the enriched
 * zone ids by array position, but enrichment moves templated (non-source)
 * zones to the end, so each hash landed under another zone's id; the global
 * hash then never matched and each pass dropped every carried global finding.
 */
describe("findings carried across enrichment passes", () => {
  // A build-script zone that enrichment templates (and moves last), sorting
  // first among four source feature zones.
  const scripts = Array.from({ length: 4 }, (_, i) => `aaa/s${i}.ts`);
  const features = ["alpha", "beta", "gamma", "delta"];
  const sources = features.flatMap((f) => Array.from({ length: 5 }, (_, i) => `src/${f}/m${i}.ts`));
  const inventory = makeInventory([
    ...scripts.map((p) => makeFileEntry(p, { role: "build", hash: `h-${p}` })),
    ...sources.map((p) => makeFileEntry(p, { hash: `h-${p}` })),
  ]);
  const imports = makeImports([
    ...scripts.map((p, i) => makeEdge(p, scripts[(i + 1) % scripts.length])),
    ...features.flatMap((f) => Array.from({ length: 5 }, (_, i) => makeEdge(`src/${f}/m${i}.ts`, `src/${f}/m${(i + 1) % 5}.ts`))),
  ]);
  const fileHashes = new Map(inventory.files.map((f) => [f.path, f.hash]));

  it("keeps every pass's findings and stores each zone's own content hash", async () => {
    // Distinct texts per call, so near-duplicate merging cannot fold them.
    const topics = ["", "layering between shell and features", "event bus fan-out from the core", "shared schema imported everywhere", "routing table duplicated per module"];
    let call = 0;
    vi.mocked(callClaude).mockImplementation(async () => {
      call++;
      const zones = features.map((f) =>
        call === 1
          ? { algorithmicId: f, id: `${f}-feature`, name: `${f} feature`, description: "d", findings: [{ type: "observation", text: `${f} groups ${topics[call]}`, severity: "info" }] }
          : { id: `${f}-feature`, findings: [{ type: "anti-pattern", text: `${f} suffers from ${topics[call]}`, severity: "warning" }] },
      );
      return { text: JSON.stringify({ zones, findings: [{ type: "pattern", text: `Across zones: ${topics[call]}`, severity: "info" }] }) };
    });

    let { zones } = await analyzeZones(inventory, imports, { enrich: true, narrate: true });
    for (let p = 0; p < 3; p++) {
      ({ zones } = await analyzeZones(inventory, imports, { enrich: true, narrate: true, previousZones: zones, reuseStructure: true }));
    }

    expect(zones.enrichmentPass).toBe(4);
    const byPass = (n: number) => (zones.findings ?? []).filter((f) => f.pass === n);
    for (const n of [1, 2, 3, 4]) {
      expect(byPass(n).filter((f) => f.scope === "global")).toHaveLength(1);
      expect(byPass(n).filter((f) => f.scope !== "global")).toHaveLength(4);
    }
    for (const z of (zones as Zones).zones) {
      expect(zones.zoneContentHashes?.[z.id]).toBe(computeZoneContentHash(z, fileHashes));
    }
  });
});
