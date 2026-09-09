// @vitest-environment jsdom
/**
 * Reviewing proposed PRD changes in the Ask panel.
 *
 * The review is the safety mechanism, so these tests are mostly about what
 * clicking does *not* do. A proposal on screen has changed nothing. A rejected
 * one is never sent. Only the accepted ones travel, and they travel with the
 * `before` they were written against so the server can refuse a stale one.
 *
 * @see packages/web/src/viewer/views/ask.ts
 * @see packages/web/src/server/routes-rex-refinements.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AskView } from "../../../src/viewer/views/ask.js";
import type { RefinementProposal } from "../../../src/viewer/views/ask.js";

async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { fn(); return; } catch { await new Promise<void>((r) => setTimeout(r, 10)); }
  }
  fn();
}

const PROPOSALS: RefinementProposal[] = [
  {
    id: "refinement-1",
    kind: "description",
    itemId: "task-1",
    itemTitle: "Ship the billing report",
    rationale: "The description does not say which month.",
    before: ["Generate the monthly invoice report."],
    after: ["Generate the invoice report for the closing month."],
  },
  {
    id: "refinement-2",
    kind: "priority",
    itemId: "task-1",
    itemTitle: "Ship the billing report",
    rationale: "Blocking the release.",
    before: ["medium"],
    after: ["high"],
  },
];

const ANSWER = {
  ok: true,
  answer: "Two changes would tighten this up.",
  vendor: "claude",
  model: "claude-opus-5",
  sources: ["CONTEXT.md"],
  proposals: PROPOSALS,
};

describe("AskView refinement review", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/sourcevision/ask") {
        return { ok: true, status: 200, json: async () => ANSWER };
      }
      if (String(input) === "/api/rex/apply-refinements") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, applied: 1, refused: 0, outcomes: [{ id: "refinement-1", applied: true }] }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Ask with the refine toggle on, and settle on the proposals. */
  async function askForRefinements({ refine = true } = {}) {
    act(() => { render(h(AskView, null), root); });
    const input = root.querySelector<HTMLTextAreaElement>(".ask-prompt-input")!;
    act(() => {
      input.value = "Tighten up the billing task.";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (refine) {
      const toggle = root.querySelector<HTMLInputElement>(".ask-refine-checkbox")!;
      act(() => {
        toggle.checked = true;
        toggle.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    act(() => { root.querySelector<HTMLButtonElement>(".ask-submit-btn")!.click(); });
    await waitFor(() => expect(root.querySelector(".ask-answered")).not.toBeNull());
  }

  function cards(): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(".ask-proposal"));
  }

  function applyCalls() {
    return fetchSpy.mock.calls.filter(([url]) => String(url) === "/api/rex/apply-refinements");
  }

  /**
   * The body of the ask request.
   *
   * Selected by URL, not by index: the panel's own hooks (the CLI name, the
   * analyze controller) fetch too, and which of them lands first is not this
   * test's business.
   */
  function askBody(): Record<string, unknown> {
    const call = fetchSpy.mock.calls.find(([url]) => String(url) === "/api/sourcevision/ask");
    return JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>;
  }

  function clickIn(card: HTMLElement, selector: string) {
    act(() => { card.querySelector<HTMLButtonElement>(selector)!.click(); });
  }

  it("asks for proposals only when the user opted in", async () => {
    await askForRefinements({ refine: false });

    expect(askBody().refinePrd).toBeUndefined();
  });

  it("sends the opt-in when the toggle is on", async () => {
    await askForRefinements();

    expect(askBody().refinePrd).toBe(true);
  });

  it("renders one reviewable card per proposal", async () => {
    await askForRefinements();

    expect(cards()).toHaveLength(2);
    expect(root.querySelector(".ask-proposals")?.textContent).toContain("Ship the billing report");
  });

  it("shows the before and the after of exactly the field it changes", async () => {
    await askForRefinements();

    const [first] = cards();
    expect(first!.querySelector(".ask-diff-before")?.textContent)
      .toContain("Generate the monthly invoice report.");
    expect(first!.querySelector(".ask-diff-after")?.textContent)
      .toContain("Generate the invoice report for the closing month.");
    // And says which field, so "before/after" is not ambiguous.
    expect(first!.querySelector(".ask-proposal-kind")?.textContent).toBe("Description");
    expect(cards()[1]!.querySelector(".ask-proposal-kind")?.textContent).toBe("Priority");
  });

  it("shows the rationale with the diff", async () => {
    await askForRefinements();

    expect(cards()[0]!.textContent).toContain("The description does not say which month.");
  });

  it("writes nothing merely by proposing", async () => {
    await askForRefinements();

    // The cards are on screen and the PRD has not been touched.
    expect(applyCalls()).toHaveLength(0);
  });

  it("writes nothing when every proposal is rejected", async () => {
    await askForRefinements();

    for (const card of cards()) clickIn(card, ".ask-proposal-reject");
    act(() => { root.querySelector<HTMLButtonElement>(".ask-apply-btn")!.click(); });

    // No request at all — not an empty one.
    await new Promise((r) => setTimeout(r, 20));
    expect(applyCalls()).toHaveLength(0);
  });

  it("sends only the accepted proposal, with the before it was written against", async () => {
    await askForRefinements();

    clickIn(cards()[0]!, ".ask-proposal-accept");
    clickIn(cards()[1]!, ".ask-proposal-reject");
    act(() => { root.querySelector<HTMLButtonElement>(".ask-apply-btn")!.click(); });

    await waitFor(() => expect(applyCalls()).toHaveLength(1));
    const sent = JSON.parse(String((applyCalls()[0]![1] as RequestInit).body));
    expect(sent.proposals).toHaveLength(1);
    expect(sent.proposals[0]).toMatchObject({
      id: "refinement-1",
      itemId: "task-1",
      before: ["Generate the monthly invoice report."],
    });
  });

  it("counts the verdicts so a reviewer can see what is undecided", async () => {
    await askForRefinements();
    expect(root.querySelector(".ask-proposals-apply")?.textContent).toContain("2 undecided");

    clickIn(cards()[0]!, ".ask-proposal-accept");
    expect(root.querySelector(".ask-proposals-apply")?.textContent).toContain("1 accepted");
    expect(root.querySelector(".ask-proposals-apply")?.textContent).toContain("1 undecided");
  });

  it("lets a verdict be taken back before anything is applied", async () => {
    await askForRefinements();

    clickIn(cards()[0]!, ".ask-proposal-accept");
    expect(cards()[0]!.className).toContain("ask-proposal-accepted");
    clickIn(cards()[0]!, ".ask-proposal-accept");

    expect(cards()[0]!.className).toContain("ask-proposal-pending");
    expect(cards()[0]!.querySelector(".ask-proposal-accept")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("reports what was applied", async () => {
    await askForRefinements();

    clickIn(cards()[0]!, ".ask-proposal-accept");
    act(() => { root.querySelector<HTMLButtonElement>(".ask-apply-btn")!.click(); });

    await waitFor(() => {
      expect(root.querySelector(".ask-apply-result")?.textContent).toContain("Applied 1 change");
    });
  });

  it("surfaces a refusal with the reason the server gave", async () => {
    await askForRefinements();
    fetchSpy.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        applied: 0,
        refused: 1,
        outcomes: [{ id: "refinement-1", applied: false, reason: '"Ship the billing report" has changed since this was proposed.' }],
      }),
    }));

    clickIn(cards()[0]!, ".ask-proposal-accept");
    act(() => { root.querySelector<HTMLButtonElement>(".ask-apply-btn")!.click(); });

    await waitFor(() => {
      expect(root.querySelector(".ask-apply-refused")?.textContent).toContain("has changed since this was proposed");
    });
  });

  it("surfaces a lock conflict rather than retrying into it", async () => {
    await askForRefinements();
    fetchSpy.mockImplementation(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        applied: 0,
        error: "Another process is writing to the PRD — nothing was changed. Held by PID 4242",
      }),
    }));

    clickIn(cards()[0]!, ".ask-proposal-accept");
    act(() => { root.querySelector<HTMLButtonElement>(".ask-apply-btn")!.click(); });

    await waitFor(() => {
      const error = root.querySelector(".ask-apply-error")?.textContent ?? "";
      expect(error).toContain("Another process is writing");
      expect(error).toContain("PID 4242");
    });
  });

  it("drops the previous answer's proposals when a new question is asked", async () => {
    await askForRefinements();
    clickIn(cards()[0]!, ".ask-proposal-accept");

    fetchSpy.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...ANSWER, answer: "No changes needed.", proposals: [] }),
    }));
    const input = root.querySelector<HTMLTextAreaElement>(".ask-prompt-input")!;
    act(() => {
      input.value = "A different question";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { root.querySelector<HTMLButtonElement>(".ask-submit-btn")!.click(); });

    // A verdict on the old answer must not be able to write the new one's.
    await waitFor(() => expect(root.querySelector(".ask-proposals")).toBeNull());
    expect(cards()).toHaveLength(0);
  });

  it("shows no proposals section for an ordinary answer", async () => {
    fetchSpy.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...ANSWER, proposals: [] }),
    }));
    await askForRefinements({ refine: false });

    expect(root.querySelector(".ask-proposals")).toBeNull();
  });
});
