// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PlanHealth, healthLights, type HealthReport } from "../../../src/viewer/views/plan-health.js";
import { STAGES } from "../../../src/viewer/views/stages.js";

const check = (name: string, errors: number, severity?: "warn") => ({
  name,
  pass: errors === 0,
  severity,
  errors: Array.from({ length: errors }, () => ({})),
});

function report(over: Partial<Record<string, number>> = {}, ranAt = "2026-11-05T09:30:00.000Z"): HealthReport {
  return {
    ranAt,
    checks: [
      check("DAG integrity", over.dag ?? 0),
      check("hierarchy placement", over.orphans ?? 0),
      check("blockedBy cycles", over.cycles ?? 0),
      check("stuck tasks", 0, "warn"),
      ...(over.stale === undefined ? [] : [check("release plans", over.stale, "warn")]),
    ],
  };
}

describe("healthLights", () => {
  it("reads one light per check, in order, with its state and count", () => {
    expect(healthLights(report({ cycles: 2, stale: 3 }))).toEqual([
      { id: "cycles", label: "Cycles", state: "fail", count: 2 },
      { id: "orphans", label: "Orphans", state: "ok", count: 0 },
      { id: "dependencies", label: "Unresolved dependencies", state: "ok", count: 0 },
      { id: "release-plans", label: "Stale release plans", state: "warn", count: 3 },
    ]);
  });

  it("draws three lights when the project has no release-plans check", () => {
    expect(healthLights(report()).map((l) => l.id)).toEqual(["cycles", "orphans", "dependencies"]);
  });
});

it("is the Plan stage's Validation tile, which still opens the Validation view", () => {
  const tile = STAGES.plan.tiles!.find((t) => t.panel === "plan-health")!;
  expect(tile.view).toBe("validation");
});

describe("PlanHealth", () => {
  let root: HTMLElement;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  function stub(bodies: unknown[]) {
    let call = 0;
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/validate")) return { ok: true, status: 200, json: async () => bodies[Math.min(call++, bodies.length - 1)] };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  }
  async function mount() {
    await act(async () => { render(h(PlanHealth, null), root); });
    await act(async () => {});
  }
  const button = (name: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name)) as HTMLButtonElement | undefined;
  const lightStates = () => [...root.querySelectorAll(".ph-light")].map((l) => `${l.getAttribute("data-light")}:${l.className.split(" ")[1]}`);

  it("shows the last result as lights with the time it ran", async () => {
    stub([report({ orphans: 1, stale: 0 })]);
    await mount();
    expect(lightStates()).toEqual(["cycles:ph-ok", "orphans:ph-fail", "dependencies:ph-ok", "release-plans:ph-ok"]);
    expect(root.querySelector(".ph-ran time")!.getAttribute("datetime")).toBe("2026-11-05T09:30:00.000Z");
  });

  it("Check runs validation again and updates the lights", async () => {
    stub([report({ cycles: 1 }), report({ cycles: 0 }, "2026-11-05T10:00:00.000Z")]);
    await mount();
    expect(lightStates()[0]).toBe("cycles:ph-fail");
    await act(async () => { button("Check")!.click(); });
    await act(async () => {});
    expect(lightStates()[0]).toBe("cycles:ph-ok");
    expect(root.querySelector(".ph-ran time")!.getAttribute("datetime")).toBe("2026-11-05T10:00:00.000Z");
  });

  it("says why when validation cannot run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "No PRD data found" }) })));
    await mount();
    expect(root.querySelector(".ph-error")!.textContent).toBe("No PRD data found");
    expect(root.querySelector(".ph-lights")).toBeNull();
  });

  it("Fix… opens only the fix preview, which asks for a dry run", async () => {
    stub([report()]);
    await mount();
    await act(async () => { button("Fix")!.click(); });
    const labels = [...root.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("Preview fixes");
    expect(labels).not.toContain("Reshape PRD (preview)");
    expect(labels).not.toContain("Run CI check");
    await act(async () => { button("Preview fixes")!.click(); });
    const fixCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/commands/fix"));
    expect(fixCalls).toHaveLength(1);
    expect(JSON.parse(fixCalls[0]![1].body)).toEqual({ dryRun: true });
  });

  it("Reshape… opens only the reshape preview", async () => {
    stub([report()]);
    await mount();
    await act(async () => { button("Reshape…")!.click(); });
    const labels = [...root.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("Reshape PRD (preview)");
    expect(labels).not.toContain("Preview fixes");
  });
});
