// @vitest-environment jsdom
/**
 * The area view's right-hand column: Moving now, Waiting in the Inbox,
 * Recently applied and Where it lives in code, each with an empty state.
 *
 * @see src/viewer/views/area-cards.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AreaCards, LINK_CODE_HELP, NO_CODE_MESSAGE, distinctChanges } from "../../../src/viewer/views/area-cards.js";
import type { AreaDetail } from "../../../src/viewer/views/product-model.js";
import { AREA_DETAIL_FIXTURE } from "../../fixtures/v2-product-map.js";

let root: HTMLDivElement;
beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
afterEach(() => { act(() => { render(null, root); }); root.remove(); });

const mount = (area: AreaDetail, props: { onOpenChange?: (id: string) => void; onPlace?: (id: string) => void } = {}) =>
  act(() => { render(h(AreaCards, { area, ...props }), root); });
const card = (id: string) => root.querySelector<HTMLElement>(`[data-card="${id}"]`)!;

const EMPTY: AreaDetail = { ...AREA_DETAIL_FIXTURE, openChanges: [], inbox: [], recentlyApplied: [], code: [] };

describe("empty states", () => {
  it("gives every card its own empty state", () => {
    mount(EMPTY);
    for (const id of ["moving", "inbox", "applied", "code"]) {
      expect(card(id).querySelector(".area-card-empty")?.textContent, id).toBeTruthy();
    }
  });

  it("offers the analysis action when no capability lists code", () => {
    mount(EMPTY);
    const code = card("code");
    expect(code.textContent).toContain(NO_CODE_MESSAGE);
    expect(code.querySelector("summary")?.textContent).toBe("Link code from the last analysis →");
    // No command fills realizedBy today, so the action must not name one.
    expect(code.querySelector("details p")?.textContent).toBe(LINK_CODE_HELP);
    expect(code.querySelector("details code")).toBeNull();
  });
});

describe("filled cards", () => {
  const area: AreaDetail = {
    ...EMPTY,
    openChanges: [
      { id: "c1", title: "Tighten placement", stage: "in-progress", delta: "modified" },
      { id: "c1", title: "Tighten placement", stage: "in-progress" },
      { id: "c2", displayId: "CH-2", title: "Add retries", stage: "ready" },
    ],
    inbox: [{ id: "i1", title: "Loose idea", target: { id: "k", title: "Placement", type: "capability" }, relation: "amends", strength: "strong" }],
    recentlyApplied: [{ id: "a1", title: "Old work", appliedAt: "2026-11-01T10:00:00Z", shippedIn: "0.9.1" }],
    code: [{ capabilityId: AREA_DETAIL_FIXTURE.capabilities[0]!.id, path: "src/a.ts" }],
  };

  it("lists each open change once with its stage chip", () => {
    expect(distinctChanges(area.openChanges)).toHaveLength(2);
    mount(area);
    const rows = [...card("moving").querySelectorAll(".area-card-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector(".area-stage")?.textContent).toBe("In progress");
    expect(card("moving").querySelector(".area-card-empty")).toBeNull();
  });

  it("offers Place on each Inbox row and passes the change id", () => {
    const onPlace = vi.fn();
    mount(area, { onPlace });
    const place = card("inbox").querySelector<HTMLButtonElement>("button.inbox-place")!;
    expect(place.getAttribute("aria-label")).toBe("Place Loose idea");
    act(() => place.click());
    expect(onPlace).toHaveBeenCalledWith("i1");
  });

  it("shows a tied guess with the tied strength chip, as the Inbox page does", () => {
    mount({ ...area, inbox: [{ ...area.inbox[0]!, strength: "tied" }] });
    expect(card("inbox").querySelector(".inbox-strength")?.getAttribute("data-strength")).toBe("tied");
  });

  it("disables Place when nothing can open the placement panel", () => {
    mount(area);
    expect(card("inbox").querySelector<HTMLButtonElement>("button.inbox-place")!.disabled).toBe(true);
  });

  it("shows applied changes and the code files under their capability", () => {
    mount(area);
    expect(card("applied").textContent).toContain("applied 2026-11-01");
    expect(card("applied").textContent).toContain("shipped in 0.9.1");
    expect(card("code").querySelector(".cap-code-path")?.textContent).toBe("src/a.ts");
    expect(card("code").querySelector(".area-card-empty")).toBeNull();
  });
});
