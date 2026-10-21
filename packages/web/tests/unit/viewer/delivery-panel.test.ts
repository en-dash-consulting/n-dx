// @vitest-environment jsdom
/**
 * The Delivery & infrastructure panel: SDLC readiness and discovered
 * infrastructure from `readiness.json` and `infrastructure.json`.
 *
 * Covers the model (narrowing, row order, grouping) and the panel with both
 * artifacts present, both absent, and an analysis that found no IaC.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import {
  DeliveryPanel,
  asInfrastructure,
  asReadiness,
  dimensionRows,
  groupInfrastructure,
  originLabel,
} from "../../../src/viewer/views/delivery.js";

async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  }
  fn();
}

const dim = (score: number, extra: object = {}) => ({ score, weight: 0.1, evidence: [], gaps: [], ...extra });

const READINESS = {
  overall: 72,
  dimensions: {
    ci: dim(100, {
      evidence: [{ kind: "workflow-job", path: ".github/workflows/ci.yml", line: 12, confidence: "certain", excerpt: "run: pnpm test" }],
    }),
    testing: dim(90),
    cd: dim(40, { gaps: [{ summary: "No deploy job", wouldRaiseScore: "a workflow that deploys on merge" }] }),
  },
  suggestions: ["Add a deploy job"],
};

const INFRA = {
  resources: [
    { id: "infra:aws_sqs_queue.orders", name: "orders", kind: "queue", origin: "infra/main.tf" },
    { id: "infra:aws_s3_bucket.assets", name: "assets", kind: "bucket", origin: "infra/main.tf" },
    { id: "infra:aws_sqs_queue.audit", name: "audit", kind: "queue", origin: "infra/main.tf" },
    { id: "infra:external.payments", name: "Payments API", kind: "service", origin: "config" },
  ],
  seams: [],
  links: [],
  sawIaC: true,
};

describe("delivery model", () => {
  it("rejects what is not a readiness score or an infrastructure file", () => {
    expect(asReadiness(null)).toBeNull();
    expect(asReadiness({ overall: "88" })).toBeNull();
    expect(asInfrastructure({ resources: "none" })).toBeNull();
    expect(asReadiness({ overall: 5, dimensions: {} })?.suggestions).toEqual([]);
  });

  it("orders dimensions as sourcevision reports them, unknown ones last by id", () => {
    const rows = dimensionRows(asReadiness({ ...READINESS, dimensions: { ...READINESS.dimensions, newPractice: dim(10) } })!);
    expect(rows.map((r) => r.label)).toEqual(["Testing", "CI", "CD", "newPractice"]);
  });

  it("groups resources by kind, both alphabetical", () => {
    const groups = groupInfrastructure(asInfrastructure(INFRA)!);
    expect(groups.map((g) => [g.kind, g.resources.map((r) => r.name)])).toEqual([
      ["bucket", ["assets"]],
      ["queue", ["audit", "orders"]],
      ["service", ["Payments API"]],
    ]);
  });

  it("names a config-declared resource's origin in words", () => {
    expect(originLabel("config")).toBe("declared in project config");
    expect(originLabel("infra/main.tf")).toBe("infra/main.tf");
  });
});

describe("DeliveryPanel", () => {
  let root: HTMLDivElement;

  function serve(files: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      const name = path.replace("/data/", "");
      return name in files
        ? new Response(JSON.stringify(files[name]), { status: 200 })
        : new Response("Not found", { status: 404 });
    }));
  }

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("shows the score, each practice and resource counts in the tile", async () => {
    serve({ "readiness.json": READINESS, "infrastructure.json": INFRA });
    render(h(DeliveryPanel, { analyzedAt: "t1" }), root);
    await waitFor(() => expect(root.querySelector(".delivery-overall-score")?.textContent).toBe("72"));
    const practices = Array.from(root.querySelectorAll(".delivery-dimension-label")).map((e) => e.textContent);
    expect(practices).toEqual(["Testing", "CI", "CD"]);
    expect(root.querySelector(".delivery-infra-counts")?.textContent).toBe("Infrastructure: 1 bucket · 2 queue · 1 service");
    expect(root.querySelector(".delivery-note")?.textContent).toMatch(/heuristic.*not whether it is good/);
  });

  it("opened, lists evidence, gaps and every resource with its origin", async () => {
    serve({ "readiness.json": READINESS, "infrastructure.json": INFRA });
    render(h(DeliveryPanel, { analyzedAt: "t1", opened: true }), root);
    await waitFor(() => expect(root.querySelector(".delivery-evidence")).not.toBeNull());
    expect(root.querySelector(".delivery-evidence code")?.textContent).toBe(".github/workflows/ci.yml:12");
    expect(root.querySelector(".delivery-gaps")?.textContent).toBe("No deploy job — a workflow that deploys on merge");
    const resources = Array.from(root.querySelectorAll(".delivery-infra-group li")).map((li) => li.textContent);
    expect(resources).toEqual([
      "assets infra/main.tf",
      "audit infra/main.tf",
      "orders infra/main.tf",
      "Payments API declared in project config",
    ]);
  });

  it("points at ndx analyze when neither artifact exists", async () => {
    serve({});
    render(h(DeliveryPanel, { analyzedAt: null }), root);
    await waitFor(() => expect(root.querySelectorAll(".delivery-empty")).toHaveLength(2));
    const text = root.textContent ?? "";
    expect(text).toContain("No readiness score yet. Run ndx analyze to produce it.");
    expect(text).toContain("No infrastructure scan yet. Run ndx analyze to produce it.");
    expect(root.querySelector(".delivery-note")).toBeNull();
  });

  it("says plainly when the scan found no infrastructure", async () => {
    serve({ "readiness.json": READINESS, "infrastructure.json": { resources: [], seams: [], links: [], sawIaC: false } });
    render(h(DeliveryPanel, { analyzedAt: "t1" }), root);
    await waitFor(() => expect(root.textContent).toContain("No infrastructure found"));
  });

  it("refetches when the analysis changes", async () => {
    serve({ "readiness.json": READINESS, "infrastructure.json": INFRA });
    render(h(DeliveryPanel, { analyzedAt: "t1" }), root);
    await waitFor(() => expect(root.querySelector(".delivery-overall-score")).not.toBeNull());
    serve({ "readiness.json": { ...READINESS, overall: 95 }, "infrastructure.json": INFRA });
    render(h(DeliveryPanel, { analyzedAt: "t2" }), root);
    await waitFor(() => expect(root.querySelector(".delivery-overall-score")?.textContent).toBe("95"));
  });
});
