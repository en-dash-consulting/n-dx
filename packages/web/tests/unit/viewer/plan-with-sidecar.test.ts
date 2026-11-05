// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PlanWithSidecarButton, PlanWithSidecarContext, planFirstTurn } from "../../../src/viewer/components/plan-with-sidecar.js";
import { SmartAddInput } from "../../../src/viewer/components/prd-tree/smart-add-input.js";
import { pageItemFor, pageItemKey, resolveLens, wantedLensFor } from "../../../src/viewer/hooks/use-sidecar-attachment.js";

let root: HTMLDivElement;
beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
const show = (vnode: Parameters<typeof render>[0]) => { act(() => { render(vnode, root); }); };
afterEach(() => { act(() => { render(null, root); }); root.remove(); });

describe("Plan with Sidecar button", () => {
  it("draws nothing while the Sidecar is off", () => {
    show(h(PlanWithSidecarButton, { text: "Add SSO" }));
    expect(root.innerHTML).toBe("");
  });

  it("sends the typed text, trimmed, with no area from the plain capture bar", () => {
    const plan = vi.fn();
    show(h(PlanWithSidecarContext.Provider, { value: { plan } }, h(PlanWithSidecarButton, { text: "  Add SSO  " })));
    act(() => { root.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(plan).toHaveBeenCalledWith("Add SSO", undefined);
  });

  it("sends the area from an area-scoped capture", () => {
    const plan = vi.fn();
    show(h(PlanWithSidecarContext.Provider, { value: { plan } }, h(PlanWithSidecarButton, { text: "Add SSO", areaId: "area-1" })));
    act(() => { root.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(plan).toHaveBeenCalledWith("Add SSO", "area-1");
  });

  it("is disabled until something is typed", () => {
    show(h(PlanWithSidecarContext.Provider, { value: { plan: vi.fn() } }, h(PlanWithSidecarButton, { text: "   " })));
    expect(root.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  });
});

describe("capture bar", () => {
  const ctx = { plan: vi.fn() };
  const realFetch = globalThis.fetch;
  // The bar reads the PRD for its scope list; an answer that never comes keeps its state updates out of the test.
  beforeEach(() => { globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });
  const bar = (layout: "v1" | "v2", sidecar: boolean) =>
    h(PlanWithSidecarContext.Provider, { value: sidecar ? ctx : null },
      h(SmartAddInput, { onPrdChanged: () => {}, bar: true, layout }));

  it("offers the button beside Preview on a v2 tree when the Sidecar is on", () => {
    show(bar("v2", true));
    expect(root.querySelector(".smart-add-btn-generate")).not.toBeNull();
    expect(root.querySelector(".smart-add-btn-sidecar")?.textContent).toBe("Plan with Sidecar");
  });

  it("omits it while web.sidecar is off", () => {
    show(bar("v2", false));
    expect(root.querySelector(".smart-add-btn-sidecar")).toBeNull();
  });

  it("omits it on a v1 tree", () => {
    show(bar("v1", true));
    expect(root.querySelector(".smart-add-btn-sidecar")).toBeNull();
  });
});

describe("Plan with Sidecar attachment", () => {
  const registry = [{ id: "plan", available: true }];

  it("asks with the Plan lens on the capture bar's page, whatever page it is", () => {
    const item = pageItemFor({ view: "analysis", zone: null, taskId: null, plan: { area: null, seq: 1 } });
    expect(item).toMatchObject({ kind: "plan", lens: "plan" });
    expect(item?.ref).toBeUndefined();
    expect(resolveLens(wantedLensFor(item, false), registry, item).running).toBe("plan");
  });

  it("targets the area from an area-scoped capture and still asks with Plan, not Explain", () => {
    const item = pageItemFor({ view: "product", zone: null, taskId: null, plan: { area: "area-1", seq: 1 } });
    expect(item).toMatchObject({ kind: "area", ref: "area-1" });
    expect(wantedLensFor(item, false)).toBe("plan");
  });

  it("an area attached without a lens asks with Explain", () => {
    expect(wantedLensFor({ kind: "area", ref: "a", label: "a" }, false)).toBe("explain");
  });

  it("gives each click its own key, so a lens chosen on Plan does not outlive asking again", () => {
    const page = { view: "plan" as const, zone: null, taskId: null };
    const onPage = pageItemKey(pageItemFor(page));
    const first = pageItemKey(pageItemFor({ ...page, plan: { area: null, seq: 1 } }));
    const second = pageItemKey(pageItemFor({ ...page, plan: { area: null, seq: 2 } }));
    expect(new Set([onPage, first, second]).size).toBe(3);
  });
});

describe("Plan with Sidecar first turn", () => {
  const base = { drawerOpen: true, ready: true, lens: "plan", busy: false, session: null, area: null, error: null };
  const wait = { action: "wait" };
  const send = { action: "send" };

  it("goes at once when there is no session yet", () => {
    expect(planFirstTurn(base)).toEqual(send);
  });

  it("waits for the drawer, the registry and an idle session", () => {
    expect(planFirstTurn({ ...base, drawerOpen: false })).toEqual(wait);
    expect(planFirstTurn({ ...base, ready: false })).toEqual(wait);
    expect(planFirstTurn({ ...base, busy: true })).toEqual(wait);
  });

  it("says why when the registry reports the Plan lens unavailable", () => {
    const next = planFirstTurn({ ...base, lens: "general" });
    expect(next).toMatchObject({ action: "fail" });
    expect((next as { reason: string }).reason).toContain("Plan lens is not available");
  });

  it("waits until the open session has followed to the Plan lens and the area", () => {
    const area = "area-1";
    expect(planFirstTurn({ ...base, area, session: { lens: "general" } })).toEqual(wait);
    expect(planFirstTurn({ ...base, area, session: { lens: "plan" } })).toEqual(wait);
    expect(planFirstTurn({ ...base, area, session: { lens: "plan", target: { ref: area } } })).toEqual(send);
    expect(planFirstTurn({ ...base, session: { lens: "plan", target: { ref: area } } })).toEqual(wait);
  });

  it("starts a new session when the open one has ended", () => {
    expect(planFirstTurn({ ...base, session: { lens: "plan", endedAt: "2026-11-05T00:00:00Z" } })).toEqual({ action: "new-session" });
  });

  it("says why when the open session could not follow the attachment", () => {
    const next = planFirstTurn({ ...base, session: { lens: "general" }, error: "Request failed (500)" });
    expect(next).toEqual({ action: "fail", reason: "Plan with Sidecar could not start: Request failed (500)" });
  });
});
