// @vitest-environment jsdom
/**
 * Accessibility tests for the FindingsList component (WCAG 2.1 §1.3.1, §4.1.2).
 *
 * Covers:
 *  - Semantic list structure (<ul role="list"> / <li>)
 *  - Filter controls as native <select> with labels
 *  - aria-live polite region for result count announcements
 *  - Severity conveyed by text label, not color alone
 *  - Expandable finding rows with aria-expanded
 *  - No orphaned aria-controls references
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { FindingsList } from "../../../src/viewer/components/data-display/findings-list.js";
import type { Finding } from "../../../src/viewer/external.js";

function makeFindings(overrides: Partial<Finding>[] = []): Finding[] {
  return overrides.map((o, i) => ({
    type: "anti-pattern",
    scope: "global",
    text: `Finding text ${i}`,
    severity: "warning",
    pass: 1,
    ...o,
  }));
}

function renderToDiv(vnode: ReturnType<typeof h>): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(vnode, root);
  return root;
}

describe("FindingsList – list semantics", () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("renders findings inside <ul role='list'>", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "Finding A", severity: "warning" },
          { text: "Finding B", severity: "info" },
        ]),
      })
    );
    const lists = root.querySelectorAll("ul[role='list']");
    expect(lists.length).toBeGreaterThan(0);
  });

  it("each finding is rendered as <li>", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "Finding A" },
          { text: "Finding B" },
        ]),
      })
    );
    const items = root.querySelectorAll("li.finding-card");
    expect(items.length).toBe(2);
  });

  it("findings region has role='region' with aria-label", () => {
    root = renderToDiv(h(FindingsList, { findings: [] }));
    const region = root.querySelector("[role='region']");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-label")).toBe("Findings list");
  });
});

describe("FindingsList – filter controls", () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("type filter renders as native <select> with label when multiple types exist", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { type: "anti-pattern", text: "Anti one" },
          { type: "suggestion", text: "Suggest one" },
          { type: "pattern", text: "Pattern one" },
        ]),
      })
    );
    const selects = root.querySelectorAll("select");
    // At minimum one select for type filter
    expect(selects.length).toBeGreaterThan(0);
    // Each select must have an associated label
    selects.forEach((select) => {
      expect(select.id).toBeTruthy();
      const label = root.querySelector(`label[for='${select.id}']`);
      expect(label).not.toBeNull();
    });
  });

  it("severity filter renders when multiple severities present", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { severity: "critical", text: "Critical one" },
          { severity: "warning", text: "Warning one" },
          { severity: "info", text: "Info one" },
        ]),
      })
    );
    // Find a select whose label contains "Severity"
    const selects = Array.from(root.querySelectorAll("select"));
    const severitySelect = selects.find((s) => {
      const label = root.querySelector(`label[for='${s.id}']`);
      return label?.textContent?.toLowerCase().includes("severity");
    });
    expect(severitySelect).not.toBeUndefined();
  });

  it("filter select options include 'all' choice", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { type: "anti-pattern", text: "A" },
          { type: "suggestion", text: "B" },
          { type: "pattern", text: "C" },
        ]),
      })
    );
    const selects = root.querySelectorAll("select");
    selects.forEach((select) => {
      const options = Array.from(select.querySelectorAll("option")).map(
        (o) => o.value
      );
      expect(options).toContain("all");
    });
  });
});

describe("FindingsList – aria-live count region", () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("renders an aria-live='polite' region showing result count", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([{ text: "Finding A" }, { text: "Finding B" }]),
      })
    );
    const live = root.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live?.getAttribute("role")).toBe("status");
    // Should show total count
    expect(live?.textContent).toContain("2");
  });

  it("live region updates when search filters results", async () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "matching alpha" },
          { text: "unrelated beta" },
          { text: "also matching alpha" },
        ]),
      })
    );
    const input = root.querySelector("input[type='search']") as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      input.value = "alpha";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const live = root.querySelector("[aria-live='polite']");
    // Should now show 2 of 3
    expect(live?.textContent).toContain("2");
    expect(live?.textContent).toContain("3");
  });
});

describe("FindingsList – severity text label", () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("severity badge has text content (not color alone)", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { severity: "critical", text: "Critical finding" },
          { severity: "warning", text: "Warning finding" },
          { severity: "info", text: "Info finding" },
        ]),
      })
    );
    const badges = root.querySelectorAll(".severity-badge");
    expect(badges.length).toBeGreaterThan(0);
    badges.forEach((badge) => {
      expect(badge.textContent?.trim()).toBeTruthy();
    });
  });

  it("severity badge has aria-label describing severity", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { severity: "critical", text: "Critical one" },
        ]),
      })
    );
    const badge = root.querySelector(".severity-badge");
    expect(badge?.getAttribute("aria-label")).toContain("critical");
  });
});

describe("FindingsList – expandable finding rows", () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("findings with related files have a button with aria-expanded", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "With related", related: ["src/foo.ts", "src/bar.ts"] },
        ]),
      })
    );
    const btn = root.querySelector("button.finding-header-btn");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
  });

  it("findings without related files do not show expand button", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "No related", related: [] },
        ]),
      })
    );
    const btn = root.querySelector("button.finding-header-btn");
    expect(btn).toBeNull();
  });

  it("clicking expand button toggles aria-expanded to true", async () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "Expandable", related: ["src/a.ts"] },
        ]),
      })
    );
    const btn = root.querySelector<HTMLButtonElement>("button.finding-header-btn")!;
    expect(btn.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      btn.click();
    });

    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("expanded content appears adjacent in DOM with correct id", async () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "Expandable", related: ["src/a.ts", "src/b.ts"] },
        ]),
      })
    );
    const btn = root.querySelector<HTMLButtonElement>("button.finding-header-btn")!;
    const controlsId = btn.getAttribute("aria-controls")!;
    expect(controlsId).toBeTruthy();

    // Before expanding: detail section is hidden
    const detail = root.querySelector(`#${controlsId}`);
    expect(detail).not.toBeNull();
    expect(detail?.getAttribute("hidden") !== null || (detail as HTMLElement)?.hidden).toBe(true);

    // After expanding: detail is visible
    await act(async () => {
      btn.click();
    });

    const detailAfter = root.querySelector(`#${controlsId}`) as HTMLElement;
    expect(detailAfter.hidden).toBe(false);
    expect(detailAfter.textContent).toContain("src/a.ts");
  });

  it("clicking again collapses back to aria-expanded='false'", async () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "Toggle test", related: ["src/z.ts"] },
        ]),
      })
    );
    const btn = root.querySelector<HTMLButtonElement>("button.finding-header-btn")!;

    await act(async () => { btn.click(); });
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    await act(async () => { btn.click(); });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("expand button has type='button' to prevent form submission", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: makeFindings([
          { text: "With related", related: ["src/x.ts"] },
        ]),
      })
    );
    const btn = root.querySelector("button.finding-header-btn");
    expect(btn?.getAttribute("type")).toBe("button");
  });
});

describe("FindingsList – legacy insights", () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("legacy insights render as <li> inside <ul role='list'>", () => {
    root = renderToDiv(
      h(FindingsList, {
        findings: [],
        legacyInsights: ["Insight A", "Insight B"],
      })
    );
    const list = root.querySelector("ul[role='list']");
    expect(list).not.toBeNull();
    const items = list!.querySelectorAll("li.finding-card");
    expect(items.length).toBe(2);
  });
});
