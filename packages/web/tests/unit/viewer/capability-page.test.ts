// @vitest-environment jsdom
/**
 * Capability page renders a v2 fixture: statement, criteria (including
 * inherited ones), history, and where the capability lives in code.
 *
 * @see src/viewer/views/capability.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { CapabilityPage } from "../../../src/viewer/views/capability.js";
import type { CapabilityDetail, ProductEdit } from "../../../src/viewer/views/product-model.js";
import { CAPABILITY_DETAIL_FIXTURE } from "../../fixtures/v2-product-map.js";

let root: HTMLDivElement | null = null;

function mount(vnode: ReturnType<typeof h>): HTMLDivElement {
  root = renderToDiv(vnode);
  return root;
}

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = null;
});

describe("CapabilityPage", () => {
  it("leads with the capability's title, area and statement", () => {
    const el = mount(h(CapabilityPage, { capability: CAPABILITY_DETAIL_FIXTURE }));

    expect(el.querySelector(".view-title")?.textContent).toBe("Autonomous task runs");
    expect(el.querySelector(".cap-area")?.textContent).toBe("Execute the work");
    expect(el.querySelector(".cap-statement-text")?.textContent)
      .toBe(CAPABILITY_DETAIL_FIXTURE.statement);
    expect(el.querySelector(".cap-display-id")?.textContent).toBe("A2.1");
  });

  it("shows computed status and health, and whether the spec was reviewed", () => {
    const el = mount(h(CapabilityPage, { capability: CAPABILITY_DETAIL_FIXTURE }));

    const badges = el.querySelector(".cap-badges");
    expect(badges?.querySelector(".pm-status")?.getAttribute("data-status")).toBe("revised");
    expect(badges?.querySelector(".pm-health")?.getAttribute("data-health")).toBe("defective");
    expect(badges?.querySelector(".cap-spec-unreviewed")).not.toBeNull();
    expect(badges?.querySelector(".cap-spec-reviewed")).toBeNull();

    // Revised or defective marks the page, the same signal the Product page uses.
    expect(el.querySelector(".cap-container-attention")).not.toBeNull();
  });

  it("lists every criterion and marks the inherited ones with their source", () => {
    const el = mount(h(CapabilityPage, { capability: CAPABILITY_DETAIL_FIXTURE }));

    const items = el.querySelectorAll(".cap-criterion");
    expect(items).toHaveLength(CAPABILITY_DETAIL_FIXTURE.criteria.length);
    expect(el.querySelector(".cap-criteria .section-header")?.textContent).toBe("Capability criteria (4)");

    const inherited = [...items].filter((li) => li.className.includes("cap-criterion-inherited"));
    expect(inherited).toHaveLength(1);
    expect(inherited[0].textContent).toContain("inherited from Cross-OS parity");

    expect(items[0].className).not.toContain("cap-criterion-inherited");
    expect(items[0].querySelector(".cap-inherited")).toBeNull();
  });

  it("renders the history of changes that moved the capability", () => {
    const el = mount(h(CapabilityPage, { capability: CAPABILITY_DETAIL_FIXTURE }));

    const rows = el.querySelectorAll(".cap-history-table tbody tr");
    expect(rows).toHaveLength(3);

    const first = rows[0];
    expect(first.getAttribute("data-change-id")).toBe("change-autonomous-loop");
    expect(first.textContent).toContain("CH-088");
    expect(first.querySelector(".cap-delta")?.textContent).toBe("added");
    expect(first.textContent).toContain("0.7.0");

    // An entry with no delta is a touch, and an entry still open has no release.
    const open = rows[2];
    expect(open.querySelector(".cap-delta")?.textContent).toBe("touches");
    expect(open.textContent).toContain("In progress");
    expect([...open.querySelectorAll("td")].map((td) => td.textContent)).toContain("—");
  });

  it("shows where the capability lives in code", () => {
    const el = mount(h(CapabilityPage, { capability: CAPABILITY_DETAIL_FIXTURE }));

    const sites = el.querySelectorAll(".cap-code-site");
    expect(sites).toHaveLength(3);
    expect(sites[0].querySelector(".cap-code-path")?.textContent)
      .toBe("packages/hench/src/cli/commands/run.ts");
    expect(sites[0].querySelector(".cap-code-role")?.textContent).toBe("entry point");
  });

  it("lists open changes and dependencies", () => {
    const el = mount(h(CapabilityPage, { capability: CAPABILITY_DETAIL_FIXTURE }));

    const overlays = el.querySelectorAll(".cap-open-changes .pm-overlay");
    expect(overlays).toHaveLength(2);
    expect(overlays[0].textContent).toContain("CH-160");
    expect(overlays[0].getAttribute("data-stage")).toBe("ready");

    const deps = el.querySelectorAll(".cap-depends-list li");
    expect([...deps].map((li) => li.textContent))
      .toEqual(["Per-task token accounting", "Automatic placement"]);
  });

  it("returns to the Product page when a handler is given", () => {
    let backs = 0;
    const el = mount(h(CapabilityPage, {
      capability: CAPABILITY_DETAIL_FIXTURE,
      onBack: () => { backs += 1; },
    }));

    const back = el.querySelector("button.cap-back") as HTMLButtonElement;
    expect(back.type).toBe("button");
    back.click();
    expect(backs).toBe(1);
  });

  it("renders the breadcrumb as plain text when no handler is given", () => {
    const el = mount(h(CapabilityPage, { capability: CAPABILITY_DETAIL_FIXTURE }));
    expect(el.querySelector("button.cap-back")).toBeNull();
    expect(el.querySelector(".cap-back-static")?.textContent).toBe("Product");
  });

  it("states what is missing rather than rendering empty sections", () => {
    const bare: CapabilityDetail = {
      ...CAPABILITY_DETAIL_FIXTURE,
      statement: undefined,
      criteria: [],
      history: [],
      code: [],
      openChanges: [],
      dependsOn: [],
      status: "proposed",
      health: "ok",
    };
    const el = mount(h(CapabilityPage, { capability: bare }));

    const messages = [...el.querySelectorAll(".empty-state")].map((n) => n.textContent ?? "");
    expect(messages.some((m) => m.includes("No statement yet"))).toBe(true);
    expect(messages.some((m) => m.includes("cannot be shown to be met"))).toBe(true);
    expect(messages.some((m) => m.includes("Nothing has amended this capability yet"))).toBe(true);
    expect(messages.some((m) => m.includes("No code sites recorded"))).toBe(true);

    // Sections with nothing to say are omitted entirely.
    expect(el.querySelector(".cap-open-changes")).toBeNull();
    expect(el.querySelector(".cap-depends-on")).toBeNull();
    expect(el.querySelector(".cap-container-attention")).toBeNull();
  });
});

// ── Direct edit ──────────────────────────────────────────────────────

describe("CapabilityPage: direct edit", () => {
  /** The same capability, met and built — the state an editorial edit applies to. */
  const MET: CapabilityDetail = {
    ...CAPABILITY_DETAIL_FIXTURE,
    status: "met",
    health: "ok",
    specReviewed: true,
    openChanges: [],
  };

  function mountEditable(capability: CapabilityDetail) {
    const edits: ProductEdit[] = [];
    const el = mount(h(CapabilityPage, { capability, onEdit: (e: ProductEdit) => { edits.push(e); } }));
    return { el, edits };
  }

  const statementBox = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>(".cap-edit-statement")!;
  const editorialBox = (el: HTMLElement) => el.querySelector<HTMLInputElement>(".cap-edit-editorial-check")!;
  const submit = (el: HTMLElement) => el.querySelector<HTMLButtonElement>(".cap-edit-submit")!;

  function type(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
    act(() => {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function check(box: HTMLInputElement) {
    act(() => {
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("renders no form when the page has nowhere to send an edit", () => {
    const el = mount(h(CapabilityPage, { capability: MET }));
    expect(el.querySelector(".cap-edit")).toBeNull();
  });

  it("offers no edit on a retired node, which rex would refuse outright", () => {
    const { el } = mountEditable({ ...MET, status: "retired" });
    expect(el.querySelector(".cap-edit")).toBeNull();
  });

  it("pre-fills the spec and leaves inherited criteria out of the form", () => {
    const { el } = mountEditable(MET);

    expect(statementBox(el).value).toBe(MET.statement);
    const ids = [...el.querySelectorAll(".cap-edit-criterion")]
      .map((i) => i.getAttribute("data-criterion-id"));
    // c4 is inherited: it belongs to the capability it comes from, so editing
    // it here would be editing a node other than the one this page names.
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("will not submit until something has actually changed", () => {
    const { el, edits } = mountEditable(MET);

    expect(submit(el).disabled).toBe(true);
    type(statementBox(el), "An agent picks the next actionable task and implements it unsupervised.");
    expect(submit(el).disabled).toBe(false);
    expect(edits).toHaveLength(0);
  });

  // The acceptance criterion: an editorial edit keeps the capability met.
  it("keeps the capability met through an editorial edit", () => {
    const { el, edits } = mountEditable(MET);

    // Before submitting, the form says which of the two outcomes this is.
    check(editorialBox(el));
    expect(el.querySelector(".cap-edit-outcome")!.textContent).toContain("stays met");
    expect(el.querySelector(".cap-edit-outcome")!.textContent).toContain("no change is drafted");

    const reworded = "An agent picks the next actionable task and implements it unsupervised.";
    type(statementBox(el), reworded);
    act(() => { submit(el).click(); });

    expect(edits).toEqual([{
      id: MET.id,
      statement: reworded,
      criteria: [
        { id: "c1", text: MET.criteria[0].text },
        { id: "c2", text: MET.criteria[1].text },
        { id: "c3", text: MET.criteria[2].text },
      ],
      editorial: true,
    }]);

    // Rex re-stamps metAt and records history; the capability comes back met,
    // and the page says so — no attention marker, no drafted change.
    const after: CapabilityDetail = { ...MET, statement: reworded };
    cleanupRenderedDiv(root!);
    root = null;
    const el2 = mount(h(CapabilityPage, { capability: after, onEdit: () => {} }));

    expect(el2.querySelector(".pm-status")!.getAttribute("data-status")).toBe("met");
    expect(el2.querySelector(".pm-status")!.textContent).toBe("Met");
    expect(el2.querySelector(".cap-container-attention")).toBeNull();
    expect(el2.querySelector(".cap-open-changes")).toBeNull();
    expect(el2.querySelector(".cap-statement-text")!.textContent).toBe(reworded);
  });

  it("says a change will be drafted when the edit is not editorial", () => {
    const { el, edits } = mountEditable(MET);

    type(statementBox(el), "An agent picks the next actionable task, implements it and opens a PR.");
    expect(el.querySelector(".cap-edit-outcome")!.textContent).toContain("a change is drafted");
    act(() => { submit(el).click(); });

    expect(edits[0].editorial).toBe(false);
  });

  it("submits an edited criterion with the statement left alone", () => {
    const { el, edits } = mountEditable(MET);

    const c2 = el.querySelector<HTMLInputElement>('.cap-edit-criterion[data-criterion-id="c2"]')!;
    type(c2, "A failing validation run ends the task without committing.");
    act(() => { submit(el).click(); });

    expect(edits[0].statement).toBe(MET.statement);
    expect(edits[0].criteria.find((c) => c.id === "c2")!.text)
      .toBe("A failing validation run ends the task without committing.");
  });

  // Rex refuses this outright: re-stamping would mark the unbuilt revision met.
  // Saying so beside a disabled box beats being refused after typing.
  it("refuses editorial on a revised node, with the reason", () => {
    const { el, edits } = mountEditable(CAPABILITY_DETAIL_FIXTURE);

    expect(editorialBox(el).disabled).toBe(true);
    expect(el.querySelector(".cap-edit-editorial-reason")!.textContent)
      .toContain("mark the unbuilt revision met");

    type(statementBox(el), "Reworded while revised.");
    act(() => { submit(el).click(); });
    expect(edits[0].editorial).toBe(false);
  });

  it("refuses editorial on a node that was never met", () => {
    const { el } = mountEditable({ ...MET, status: "proposed" });

    expect(editorialBox(el).disabled).toBe(true);
    expect(el.querySelector(".cap-edit-editorial-reason")!.textContent).toContain("no met spec to re-stamp");
  });
});
