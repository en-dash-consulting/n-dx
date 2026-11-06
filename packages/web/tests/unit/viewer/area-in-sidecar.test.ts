// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PlanInAreaButton, PlanWithSidecarContext, type PlanWithSidecar } from "../../../src/viewer/components/plan-with-sidecar.js";
import { pageItemFor, resolveLens, wantedLensFor, type SidecarPageSelection } from "../../../src/viewer/hooks/use-sidecar-attachment.js";

const area = { id: "area-1", label: "Billing", capabilityId: null };
const page = (over: Partial<SidecarPageSelection> = {}): SidecarPageSelection =>
  ({ view: "product", zone: null, taskId: null, areaView: area, ...over });

describe("the area view's page item", () => {
  it("is an area item, whose ref is the area id, on the Product page and on Plan's tile", () => {
    for (const view of ["product", "plan"] as const) {
      expect(pageItemFor(page({ view }))).toEqual({ kind: "area", ref: "area-1", label: "Billing" });
    }
  });

  it("asks with Explain, which the registry runs on the area", () => {
    const item = pageItemFor(page());
    expect(wantedLensFor(item, false)).toBe("explain");
    expect(resolveLens("explain", [{ id: "explain", available: true }], item).running).toBe("explain");
  });

  it("attaches a capability selected in the area as a capability", () => {
    const item = pageItemFor(page({ areaView: { ...area, capabilityId: "cap-9" } }));
    expect(item).toMatchObject({ kind: "capability", ref: "cap-9" });
    expect(wantedLensFor(item, false)).toBe("explain");
  });

  it("is no item once the area view has closed", () => {
    expect(pageItemFor(page({ view: "home", areaView: null }))).toBeNull();
    expect(pageItemFor(page({ view: "plan", areaView: null }))).toMatchObject({ kind: "plan" });
  });

  it("gives way to the Plan lens that Plan in this area asked for", () => {
    const item = pageItemFor(page({ plan: { area: "area-1", seq: 1 } }));
    expect(item).toMatchObject({ kind: "area", ref: "area-1", lens: "plan" });
    expect(wantedLensFor(item, false)).toBe("plan");
  });
});

describe("Plan in this area", () => {
  let root: HTMLDivElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { act(() => { render(null, root); }); root.remove(); });

  it("draws nothing while the Sidecar is off", () => {
    act(() => { render(h(PlanInAreaButton, { areaId: "area-1" }), root); });
    expect(root.innerHTML).toBe("");
  });

  it("switches the session to the Plan lens aimed at the area", () => {
    const planIn = vi.fn();
    const value: PlanWithSidecar = { plan: vi.fn(), planIn, reportArea: vi.fn() };
    act(() => { render(h(PlanWithSidecarContext.Provider, { value }, h(PlanInAreaButton, { areaId: "area-1" })), root); });
    const button = root.querySelector("button");
    expect(button?.textContent).toBe("Plan in this area");
    act(() => { button?.click(); });
    expect(planIn).toHaveBeenCalledWith("area-1");
    expect(value.plan).not.toHaveBeenCalled();
  });
});
