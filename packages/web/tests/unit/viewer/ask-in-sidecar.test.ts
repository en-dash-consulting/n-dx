// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AskInSidecarButton, AskInSidecarContext } from "../../../src/viewer/components/ask-in-sidecar.js";
import { pageItemFor, resolveLens, wantedLensFor } from "../../../src/viewer/hooks/use-sidecar-attachment.js";

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

describe("the lens an ask attaches", () => {
  const page = { view: "prd" as const, zone: null, taskId: null };

  it("asks about a task with Describe, or Diagnose run after a failed run", () => {
    const item = pageItemFor({ ...page, ask: { kind: "task", ref: "T1", seq: 1 } });
    expect(item).toMatchObject({ kind: "task", ref: "T1" });
    expect(wantedLensFor(item, false)).toBe("describe");
    expect(wantedLensFor(item, true)).toBe("diagnose-run");
  });

  it.each(["capability", "zone"] as const)("explains a %s", (kind) => {
    const item = pageItemFor({ ...page, ask: { kind, ref: "X", seq: 1 } });
    expect(item).toMatchObject({ kind, ref: "X" });
    expect(resolveLens(wantedLensFor(item, false), REGISTRY, item).running).toBe("explain");
  });

  it("gives each click its own key, so a removed item is attached again", () => {
    const first = pageItemFor({ ...page, ask: { kind: "zone", ref: "z1", seq: 1 } });
    const second = pageItemFor({ ...page, ask: { kind: "zone", ref: "z1", seq: 2 } });
    expect(first?.key).not.toBe(second?.key);
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

  it("names Place, waiting on a change, while none is selected", () => {
    const item = pageItemFor(inbox);
    expect(resolveLens("place", REGISTRY, item)).toMatchObject({ wanted: "place", running: "general", needs: "a change to place" });
  });
});
