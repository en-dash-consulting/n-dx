// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { DescribeInSidecarButton, DescribeInSidecarContext } from "../../../src/viewer/components/describe-in-sidecar.js";
import { ChangesGlance } from "../../../src/viewer/views/changes-glance.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { specGaps } from "../../../src/viewer/views/spec-gaps.js";
import { pageItemFor, resolveLens, wantedLensFor } from "../../../src/viewer/hooks/use-sidecar-attachment.js";
import type { ChangeSummary, GlanceChange } from "../../../src/viewer/views/product-model.js";

function change(id: string, over: Partial<GlanceChange> = {}): GlanceChange {
  return { id, title: `Change ${id}`, stage: "proposed", taskCount: 0, completedTaskCount: 0, criteriaGap: false, openBlockers: 0, ...over };
}

function summary(open: GlanceChange[], over: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    inbox: 0,
    inboxInStage: 0,
    stages: { proposed: 0, ready: 0, "in-progress": 0, "awaiting-apply": 0 },
    open,
    next: null,
    requirements: { total: 1, uncovered: 0 },
    ...over,
  };
}

describe("Describe in Sidecar", () => {
  let root: HTMLDivElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  it("draws nothing while the Sidecar is off", () => {
    render(h(DescribeInSidecarButton, { changeId: "C1" }), root);
    expect(root.innerHTML).toBe("");
  });

  it("attaches the change and takes a label", () => {
    const describe = vi.fn();
    render(
      h(DescribeInSidecarContext.Provider, { value: { describe, attached: "C1" } },
        h(DescribeInSidecarButton, { changeId: "C1", label: "Tighten with Sidecar" })),
      root,
    );
    const button = root.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Tighten with Sidecar");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    act(() => { button?.click(); });
    expect(describe).toHaveBeenCalledWith("C1");
  });

  it("asks with the Describe lens on the change, over the Place lens a change otherwise gets", () => {
    const item = pageItemFor({ view: "plan", zone: null, taskId: null, describeChangeId: "C1" });
    expect(item).toMatchObject({ kind: "change", ref: "C1", lens: "describe" });
    expect(wantedLensFor(item, false)).toBe("describe");
    expect(resolveLens("describe", [{ id: "describe", available: true }], item).running).toBe("describe");
  });

  it("points each Specs to tighten line at the first change it counts", () => {
    const { rows } = specGaps(summary(
      [change("a"), change("b", { criteriaGap: true }), change("c", { criteriaGap: true }), change("d", { stage: "awaiting-apply" })],
      { stages: { proposed: 0, ready: 0, "in-progress": 0, "awaiting-apply": 1 } },
    ));
    expect(rows.map((r) => [r.key, r.changeId])).toEqual([["no-criteria", "b"], ["review", "d"]]);
  });

  it("offers Describe on each Open changes row only with the Sidecar on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ summary: summary([change("a")]) }),
    })));
    const navigateTo = vi.fn();
    const draw = async (value: { describe: () => void; attached: null } | null) => {
      await act(async () => { render(h(DescribeInSidecarContext.Provider, { value }, h(ChangesSummaryProvider, null, h(ChangesGlance, { navigateTo }))), root); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    };
    await draw(null);
    expect(root.querySelector(".cg-row")).not.toBeNull();
    expect(root.querySelector(".describe-in-sidecar")).toBeNull();
    await draw({ describe: vi.fn(), attached: null });
    expect(root.querySelector(".cg-row .describe-in-sidecar")?.textContent).toBe("Describe in Sidecar");
  });
});
