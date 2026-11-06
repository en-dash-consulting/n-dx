// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AskInSidecarButton, AskInSidecarContext } from "../../../src/viewer/components/ask-in-sidecar.js";
import { pageItemFor, resolveLens, wantedLensFor } from "../../../src/viewer/hooks/use-sidecar-attachment.js";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import { ZoneSlideout } from "../../../src/viewer/components/zone-slideout.js";
import { CapabilityPage } from "../../../src/viewer/views/capability.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";
import type { Zone } from "../../../src/viewer/external.js";
import { CAPABILITY_DETAIL_FIXTURE } from "../../fixtures/v2-product-map.js";

const REGISTRY = [
  { id: "describe", available: true },
  { id: "diagnose-run", available: true, target: { kind: "task", needs: "a task to diagnose" } },
  { id: "explain", available: true },
  { id: "place", available: true, target: { kind: "change", needs: "a change to place" } },
];

describe("Ask and Explain in Sidecar buttons", () => {
  let root: HTMLDivElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { render(null, root); root.remove(); });

  it.each([
    ["task", "T1", "Ask Sidecar"],
    ["capability", "C1", "Explain in Sidecar"],
    ["zone", "z1", "Explain in Sidecar"],
  ] as const)("a %s page's button opens the drawer with that item attached", (kind, id, label) => {
    const ask = vi.fn();
    render(
      h(AskInSidecarContext.Provider, { value: { ask, attached: null } },
        h(AskInSidecarButton, { kind, itemId: id })),
      root,
    );
    const button = root.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe(label);
    act(() => { button?.click(); });
    expect(ask).toHaveBeenCalledWith(kind, id);
  });

  it("marks the attached item pressed", () => {
    render(
      h(AskInSidecarContext.Provider, { value: { ask: vi.fn(), attached: { kind: "zone", ref: "z1" } } },
        h(AskInSidecarButton, { kind: "zone", itemId: "z1" })),
      root,
    );
    expect(root.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("draws nothing while web.sidecar is off", () => {
    for (const kind of ["task", "capability", "zone"] as const) {
      render(h(AskInSidecarButton, { kind, itemId: "x" }), root);
      expect(root.innerHTML).toBe("");
    }
  });
});

describe("the pages that draw them", () => {
  let root: HTMLDivElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { act(() => { render(null, root); }); root.remove(); });

  const zone = {
    id: "zone-1", name: "Zone One", description: "A test zone",
    files: ["src/a.ts"], entryPoints: [], cohesion: 0.7, coupling: 0.2,
  } as Zone;
  const task: PRDItemData = { id: "task-1", title: "A task", status: "pending", level: "task" };
  const pages = [
    ["task", "task-1", "Ask Sidecar", () => h(TaskDetail, { item: task, allItems: [task], onUpdate: vi.fn() })],
    ["capability", CAPABILITY_DETAIL_FIXTURE.id, "Explain in Sidecar", () => h(CapabilityPage, { capability: CAPABILITY_DETAIL_FIXTURE })],
    ["zone", "zone-1", "Explain in Sidecar", () => h(ZoneSlideout, { zone, crossings: [], allZones: [zone], onClose: vi.fn() })],
  ] as const;

  it.each(pages)("a %s page offers its button, which asks about that item", (kind, id, label, page) => {
    const ask = vi.fn();
    act(() => { render(h(AskInSidecarContext.Provider, { value: { ask, attached: null } }, page()), root); });
    const button = root.querySelector<HTMLButtonElement>(".ask-in-sidecar");
    expect(button?.textContent).toBe(label);
    act(() => { button?.click(); });
    expect(ask).toHaveBeenCalledWith(kind, id);
  });

  it.each(pages)("a %s page draws no button while web.sidecar is off", (_kind, _id, _label, page) => {
    act(() => { render(page(), root); });
    expect(root.querySelector(".ask-in-sidecar")).toBeNull();
  });
});

describe("the lens an ask attaches", () => {
  const page = { view: "prd" as const, zone: null, taskId: null };

  it("asks about a task with Describe, or Diagnose run after a failed run", () => {
    const item = pageItemFor({ ...page, taskId: "T1", ask: { kind: "task", ref: "T1", seq: 1 } });
    expect(item).toMatchObject({ kind: "task", ref: "T1" });
    expect(wantedLensFor(item, false)).toBe("describe");
    expect(wantedLensFor(item, true)).toBe("diagnose-run");
  });

  it.each(["capability", "zone"] as const)("explains a %s", (kind) => {
    const item = pageItemFor({
      ...page,
      view: kind === "zone" ? "zones" : "product",
      zone: kind === "zone" ? "X" : null,
      capabilityId: kind === "capability" ? "X" : null,
      ask: { kind, ref: "X", seq: 1 },
    });
    expect(item).toMatchObject({ kind, ref: "X" });
    expect(resolveLens(wantedLensFor(item, false), REGISTRY, item).running).toBe("explain");
  });

  it("gives each click its own key, so a removed item is attached again", () => {
    const zones = { ...page, view: "zones" as const, zone: "z1" };
    const first = pageItemFor({ ...zones, ask: { kind: "zone", ref: "z1", seq: 1 } });
    const second = pageItemFor({ ...zones, ask: { kind: "zone", ref: "z1", seq: 2 } });
    expect(first?.key).not.toBe(second?.key);
  });
});

describe("an ask when the page moves to another item in the same view", () => {
  it("attaches the newly opened task with its default lens, not the asked one", () => {
    const ask = { kind: "task" as const, ref: "T1", seq: 1 };
    const item = pageItemFor({ view: "prd", zone: null, taskId: "T2", ask });
    expect(item).toMatchObject({ kind: "task", ref: "T2" });
    expect(wantedLensFor(item, false)).toBe("describe");
  });

  it.each([
    ["capability", { view: "product" as const, zone: null, taskId: null, capabilityId: "B" }],
    ["zone", { view: "zones" as const, zone: "B", taskId: null }],
  ] as const)("attaches the newly opened %s B, not the asked A", (kind, page) => {
    const item = pageItemFor({ ...page, ask: { kind, ref: "A", seq: 1 } });
    expect(item).toMatchObject({ kind, ref: "B" });
    expect(wantedLensFor(item, false)).toBe("explain");
    expect(item?.key).toBeUndefined();
  });
});

describe("the Inbox page", () => {
  const inbox = { view: "inbox" as const, zone: null, taskId: null };

  it("picks the Place lens", () => {
    const item = pageItemFor(inbox);
    expect(item).toMatchObject({ kind: "inbox" });
    expect(wantedLensFor(item, false)).toBe("place");
  });

  it("attaches the selected change and runs Place on it", () => {
    const item = pageItemFor({ ...inbox, changeId: "ch1" });
    expect(item).toMatchObject({ kind: "change", ref: "ch1" });
    expect(resolveLens(wantedLensFor(item, false), REGISTRY, item).running).toBe("place");
  });

  it("attaches the change selected in the triage queue and runs Place on it", () => {
    const item = pageItemFor({ ...inbox, inboxChangeId: "ch2" });
    expect(item).toMatchObject({ kind: "change", ref: "ch2" });
    expect(resolveLens(wantedLensFor(item, false), REGISTRY, item).running).toBe("place");
  });

  it("ignores a stale queue selection off the Inbox page", () => {
    expect(pageItemFor({ view: "plan", zone: null, taskId: null, inboxChangeId: "ch2" })).toMatchObject({ kind: "plan" });
  });

  it("names Place, waiting on a change, while none is selected", () => {
    const item = pageItemFor(inbox);
    expect(resolveLens("place", REGISTRY, item)).toMatchObject({ wanted: "place", running: "general", needs: "a change to place" });
  });
});
