// @vitest-environment jsdom
/**
 * Capability page renders a v2 fixture: statement, criteria (including
 * inherited ones), history, and where the capability lives in code.
 *
 * @see src/viewer/views/capability.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { h } from "preact";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { CapabilityPage } from "../../../src/viewer/views/capability.js";
import type { CapabilityDetail } from "../../../src/viewer/views/product-model.js";
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
    expect(el.querySelector(".cap-criteria .section-header")?.textContent).toBe("Criteria (4)");

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
