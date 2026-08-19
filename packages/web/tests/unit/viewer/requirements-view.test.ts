// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RequirementsView } from "../../../src/viewer/views/requirements.js";

const COVERAGE = {
  totalItems: 40,
  itemsWithRequirements: 8,
  itemsWithInheritedRequirements: 22,
  itemsWithNoRequirements: 10,
  totalRequirements: 12,
  byCategory: { security: 5, performance: 4, quality: 3 },
  byValidationType: { automated: 7, manual: 5 },
  byPriority: { high: 6, medium: 6 },
  coveragePercent: 75,
};

const TRACEABILITY = {
  matrix: [
    {
      requirement: {
        id: "req-1",
        title: "All inputs validated",
        category: "security",
        validationType: "automated",
        acceptanceCriteria: ["No unvalidated input reaches handlers"],
      },
      definedOnItemId: "epic-1",
      definedOnItemTitle: "Security Epic",
      definedOnItemLevel: "epic",
      appliesTo: [
        { id: "t1", title: "Sanitize form input", level: "task", status: "completed" },
        { id: "t2", title: "Validate API payloads", level: "task", status: "pending" },
      ],
    },
  ],
};

function routeMock(url: string): unknown {
  if (url.endsWith("/coverage")) return COVERAGE;
  if (url.endsWith("/traceability")) return TRACEABILITY;
  return {};
}

describe("RequirementsView", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => routeMock(url),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function renderView() {
    act(() => {
      render(h(RequirementsView, null), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});
  }

  it("renders coverage stats and breakdowns", async () => {
    await renderView();
    expect(root.textContent).toContain("75%");
    expect(root.textContent).toContain("12");
    expect(root.textContent).toContain("security");
    expect(root.textContent).toContain("automated");
  });

  it("renders the traceability matrix with defined-on item", async () => {
    await renderView();
    expect(root.textContent).toContain("All inputs validated");
    expect(root.textContent).toContain("Security Epic");
    expect(root.textContent).toContain("2"); // applies-to count
  });

  it("expands a requirement row to show applied items with status", async () => {
    await renderView();
    const expander = Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("2 item"))!;
    await act(async () => {
      expander.click();
    });
    expect(root.textContent).toContain("Sanitize form input");
    expect(root.textContent).toContain("pending");
    expect(root.textContent).toContain("No unvalidated input reaches handlers");
  });

  it("shows an empty state when no requirements exist", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith("/coverage")
          ? { ...COVERAGE, totalRequirements: 0, coveragePercent: 0 }
          : { matrix: [] },
    }));
    await renderView();
    expect(root.textContent?.toLowerCase()).toContain("no requirements");
  });

  it("shows an error state when the API fails", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await renderView();
    expect(root.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
});
