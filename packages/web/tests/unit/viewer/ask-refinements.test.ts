// @vitest-environment jsdom
/**
 * PRD refinement review in the Ask panel.
 *
 * Covers the three properties the review surface rests on, none of which a
 * typecheck can see:
 *
 *  1. Each proposal renders a before/after diff of exactly the fields it
 *     changes, and each is accepted or rejected on its own.
 *  2. Rejecting issues no request. The assertion is on the *absence* of a call
 *     to the apply endpoint, not on the card disappearing — a card that
 *     disappears after a write is indistinguishable from one that disappears
 *     without one, and only the second is correct.
 *  3. A refusal from the apply route — a stale proposal, a held lock — is
 *     rendered as the server worded it rather than as a status code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AskView, ASK_ENDPOINT } from "../../../src/viewer/views/ask.js";
import {
  REFINEMENT_APPLY_ENDPOINT,
  describeProposal,
  outcomeStates,
  type RefinementProposal,
} from "../../../src/viewer/views/ask-refinements.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

/** An edit proposal, as the endpoint would send it. */
function editProposal(overrides: Partial<RefinementProposal> = {}): RefinementProposal {
  return {
    id: "r1",
    op: "edit",
    itemId: "task-a",
    itemTitle: "Add the Ask panel",
    itemLevel: "task",
    rationale: "The criteria do not say what done looks like.",
    diffs: [{
      field: "acceptanceCriteria",
      before: ["The panel renders"],
      after: ["The panel renders", "The panel reports a failure by name"],
    }],
    baseline: [{ itemId: "task-a", fingerprint: "abc123" }],
    ...overrides,
  };
}

describe("AskView — PRD refinement proposals", () => {
  let root: HTMLDivElement;
  let askResponse: () => Promise<Response>;
  let applyResponse: () => Promise<Response>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  function mount() {
    root = document.createElement("div");
    document.body.appendChild(root);
    render(h(AskView, null), root);
    return root;
  }

  function refineToggle(): HTMLInputElement {
    const el = root.querySelector<HTMLInputElement>("input.sv-ask-mode-toggle");
    if (!el) throw new Error("refine toggle not rendered");
    return el;
  }

  function proposalCards(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>("li.sv-ask-proposal")];
  }

  function applyCalls(): unknown[][] {
    return fetchSpy.mock.calls.filter(([u]) => String(u) === REFINEMENT_APPLY_ENDPOINT);
  }

  async function click(el: Element | null): Promise<void> {
    if (!el) throw new Error("control not rendered");
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  /** Ask a refine-mode question and let the answer land. */
  async function askInRefineMode(question = "Is the Ask epic well specified?"): Promise<void> {
    await act(async () => {
      refineToggle().checked = true;
      refineToggle().dispatchEvent(new Event("change", { bubbles: true }));
    });
    const el = root.querySelector<HTMLTextAreaElement>("textarea.sv-ask-textarea")!;
    await act(async () => {
      el.value = question;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = root.querySelector<HTMLFormElement>("form.sv-ask-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  beforeEach(() => {
    clearProjectMetadataCache();
    delete window.__NDX_DEPLOYED__;
    askResponse = async () => jsonResponse({
      answer: "The acceptance criteria are vague.",
      vendor: "claude",
      model: "test-model",
      proposals: [editProposal()],
      refinementNotes: [],
    });
    applyResponse = async () => jsonResponse({
      ok: true,
      applied: 1,
      refused: 0,
      outcomes: [{ id: "r1", itemId: "task-a", status: "applied" }],
    });
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === ASK_ENDPOINT) return askResponse();
      if (url === REFINEMENT_APPLY_ENDPOINT) return applyResponse();
      if (url === "/api/project") {
        return jsonResponse({
          name: "n-dx", description: null, version: null, git: null,
          nameSource: "directory", cliName: "n-dx",
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
    document.body.innerHTML = "";
    delete window.__NDX_DEPLOYED__;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── Mode ─────────────────────────────────────────────────────────

  it("asks in plain mode unless refine is turned on", async () => {
    mount();
    await settle();
    expect(refineToggle().checked).toBe(false);

    const el = root.querySelector<HTMLTextAreaElement>("textarea.sv-ask-textarea")!;
    await act(async () => {
      el.value = "Which zones are most coupled?";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = root.querySelector<HTMLFormElement>("form.sv-ask-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    const [, init] = fetchSpy.mock.calls.find(([u]) => String(u) === ASK_ENDPOINT)!;
    const body = JSON.parse((init as RequestInit).body as string);
    // Absent, not `mode: "ask"`: sending the default explicitly would make the
    // server's default and the client's two places to change one behaviour.
    expect(body.mode).toBeUndefined();
  });

  it("sends mode:refine when the toggle is on", async () => {
    mount();
    await settle();
    await askInRefineMode();

    const [, init] = fetchSpy.mock.calls.find(([u]) => String(u) === ASK_ENDPOINT)!;
    expect(JSON.parse((init as RequestInit).body as string).mode).toBe("refine");
  });

  it("describes the toggle so the cost and the safeguard are both stated", () => {
    mount();
    const hint = root.querySelector(".sv-ask-mode-hint")?.textContent ?? "";
    expect(hint).toContain("PRD");
    expect(hint).toContain("nothing is written until you accept");
    // The hint is associated with the control, not merely adjacent to it.
    expect(refineToggle().getAttribute("aria-describedby"))
      .toBe(root.querySelector(".sv-ask-mode-hint")?.id);
  });

  // ── Rendering the diff ───────────────────────────────────────────

  it("renders a before/after pair for exactly the field that changes", async () => {
    mount();
    await settle();
    await askInRefineMode();

    const [card] = proposalCards();
    expect(card).toBeDefined();
    const fields = [...card.querySelectorAll(".sv-ask-diff-field")].map((n) => n.textContent);
    expect(fields).toEqual(["Acceptance criteria"]);

    const before = card.querySelector(".sv-ask-diff-before")?.textContent ?? "";
    const after = card.querySelector(".sv-ask-diff-after")?.textContent ?? "";
    expect(before).toContain("The panel renders");
    expect(before).not.toContain("reports a failure by name");
    expect(after).toContain("reports a failure by name");
  });

  it("states an absent before side rather than rendering an empty box", async () => {
    askResponse = async () => jsonResponse({
      answer: "It has no description at all.",
      proposals: [editProposal({
        diffs: [{ field: "description", before: [], after: ["A description, at last."] }],
      })],
      refinementNotes: [],
    });
    mount();
    await settle();
    await askInRefineMode();

    const before = proposalCards()[0].querySelector(".sv-ask-diff-before");
    expect(before?.textContent).toContain("(not set)");
  });

  it("names what the proposal does, which the values alone do not say", async () => {
    mount();
    await settle();
    await askInRefineMode();

    const summary = proposalCards()[0].querySelector(".sv-ask-proposal-summary")?.textContent ?? "";
    expect(summary).toContain("acceptance criteria");
    expect(proposalCards()[0].getAttribute("data-proposal-op")).toBe("edit");
  });

  it("surfaces the server's notes about proposals it dropped", async () => {
    askResponse = async () => jsonResponse({
      answer: "Two ideas, one unusable.",
      proposals: [],
      refinementNotes: ['Skipped "Foo": "urgent" is not a valid priority.'],
    });
    mount();
    await settle();
    await askInRefineMode();

    expect(root.querySelector(".sv-ask-proposals")?.textContent)
      .toContain("not a valid priority");
  });

  it("shows no proposal card at all when the answer carried none", async () => {
    askResponse = async () => jsonResponse({ answer: "Nothing to change.", proposals: [], refinementNotes: [] });
    mount();
    await settle();
    await askInRefineMode();

    expect(root.querySelector(".sv-ask-proposals")).toBeNull();
    expect(proposalCards()).toHaveLength(0);
  });

  // ── Accept ───────────────────────────────────────────────────────

  it("posts only the accepted proposal, verbatim", async () => {
    askResponse = async () => jsonResponse({
      answer: "Two changes.",
      proposals: [editProposal(), editProposal({ id: "r2", itemId: "task-b", itemTitle: "Second" })],
      refinementNotes: [],
    });
    mount();
    await settle();
    await askInRefineMode();
    expect(proposalCards()).toHaveLength(2);

    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-accept"));

    expect(applyCalls()).toHaveLength(1);
    const body = JSON.parse((applyCalls()[0][1] as RequestInit).body as string);
    // One proposal, not the pending list: accepting one change must never
    // apply another the user has not looked at.
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].id).toBe("r1");
    // The baseline goes back untouched — it is what the apply route re-checks
    // under the lock, so rewriting it here would defeat the staleness guard.
    expect(body.proposals[0].baseline).toEqual([{ itemId: "task-a", fingerprint: "abc123" }]);
  });

  it("reports an applied change on the card it belongs to", async () => {
    mount();
    await settle();
    await askInRefineMode();
    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-accept"));

    const card = proposalCards()[0];
    expect(card.className).toContain("sv-ask-proposal-applied");
    expect(card.querySelector(".sv-ask-proposal-result-ok")?.textContent).toContain("Applied");
    // The decision has been made, so the controls go.
    expect(card.querySelector("button.sv-ask-proposal-accept")).toBeNull();
  });

  it("renders a stale refusal in the server's words", async () => {
    applyResponse = async () => jsonResponse({
      ok: false,
      applied: 0,
      refused: 1,
      outcomes: [{
        id: "r1",
        itemId: "task-a",
        status: "stale",
        detail: '"Add the Ask panel" has changed since this proposal was generated.',
      }],
    });
    mount();
    await settle();
    await askInRefineMode();
    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-accept"));

    const card = proposalCards()[0];
    expect(card.className).toContain("sv-ask-proposal-refused");
    const result = card.querySelector(".sv-ask-proposal-result-fail");
    expect(result?.textContent).toContain("has changed since this proposal was generated");
    // A refusal is the one outcome the user must not miss: the change they
    // approved did not happen.
    expect(result?.getAttribute("role")).toBe("alert");
  });

  it("passes through the held-lock message, which names the holder", async () => {
    applyResponse = async () => jsonResponse({
      error: "Could not acquire PRD lock within 5000ms. Held by PID 4212 (since 2026-09-04T00:00:00.000Z).",
    }, 409);
    mount();
    await settle();
    await askInRefineMode();
    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-accept"));

    const reason = proposalCards()[0].querySelector(".sv-ask-proposal-reason")?.textContent ?? "";
    expect(reason).toContain("PID 4212");
    // Not a bare status code — the PID is the whole value of this failure.
    expect(reason).not.toBe("The change could not be applied (409).");
  });

  it("names a response the server did not write, rather than rendering it raw", async () => {
    applyResponse = async () => new Response("<html>502 Bad Gateway</html>", { status: 502 });
    mount();
    await settle();
    await askInRefineMode();
    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-accept"));

    expect(proposalCards()[0].querySelector(".sv-ask-proposal-reason")?.textContent)
      .toContain("could not be applied");
  });

  // ── Reject ───────────────────────────────────────────────────────

  it("rejecting writes nothing: no request is made at all", async () => {
    mount();
    await settle();
    await askInRefineMode();
    expect(proposalCards()).toHaveLength(1);

    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-reject"));

    // The assertion that matters. A card that vanished after a write looks the
    // same as one that vanished without one.
    expect(applyCalls()).toHaveLength(0);
    expect(proposalCards()).toHaveLength(0);
  });

  it("rejecting one proposal leaves the others reviewable", async () => {
    askResponse = async () => jsonResponse({
      answer: "Two changes.",
      proposals: [editProposal(), editProposal({ id: "r2", itemId: "task-b", itemTitle: "Second" })],
      refinementNotes: [],
    });
    mount();
    await settle();
    await askInRefineMode();

    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-reject"));

    expect(applyCalls()).toHaveLength(0);
    expect(proposalCards().map((c) => c.getAttribute("data-proposal-id"))).toEqual(["r2"]);
  });

  it("rejecting every proposal issues no request", async () => {
    askResponse = async () => jsonResponse({
      answer: "Two changes.",
      proposals: [editProposal(), editProposal({ id: "r2", itemId: "task-b", itemTitle: "Second" })],
      refinementNotes: [],
    });
    mount();
    await settle();
    await askInRefineMode();

    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-reject"));
    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-reject"));

    expect(proposalCards()).toHaveLength(0);
    expect(applyCalls()).toHaveLength(0);
  });

  // ── Lifecycle ────────────────────────────────────────────────────

  it("drops the previous answer's proposals when a new question is asked", async () => {
    mount();
    await settle();
    await askInRefineMode();
    await click(proposalCards()[0].querySelector("button.sv-ask-proposal-accept"));
    expect(proposalCards()[0].className).toContain("sv-ask-proposal-applied");

    // Same proposal id, different answer. Ids are only unique within one
    // answer, so a carried-over card state would mark this one applied.
    askResponse = async () => jsonResponse({
      answer: "A different reading.",
      proposals: [editProposal({ itemTitle: "A different item" })],
      refinementNotes: [],
    });
    await askInRefineMode("And now?");

    const card = proposalCards()[0];
    expect(card.className).not.toContain("sv-ask-proposal-applied");
    expect(card.querySelector("button.sv-ask-proposal-accept")).not.toBeNull();
  });

  it("announces that changes are waiting, not only that an answer arrived", async () => {
    mount();
    await settle();
    await askInRefineMode();

    const announced = root.querySelector(".sv-ask-announcer")?.textContent ?? "";
    expect(announced).toContain("Answer ready");
    expect(announced).toContain("1 proposed PRD change is waiting for review");
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("describeProposal", () => {
  it("names the operation, which the diff values do not", () => {
    expect(describeProposal(editProposal())).toContain("Rewrite the acceptance criteria");
    expect(describeProposal(editProposal({ op: "reparent" }))).toContain("different parent");
    expect(describeProposal(editProposal({ op: "merge", intoTitle: "Other task" })))
      .toContain('into "Other task"');
  });
});

describe("outcomeStates", () => {
  it("refuses a proposal the server said nothing about", () => {
    const states = outcomeStates([editProposal()], []);
    const state = states.get("r1");
    expect(state?.status).toBe("refused");
    // Silence from a write endpoint is not evidence of a write.
    expect(state).not.toEqual({ status: "applied" });
  });

  it("falls back to wording for a refusal that carried no detail", () => {
    const states = outcomeStates([editProposal()], [{ id: "r1", itemId: "task-a", status: "stale" }]);
    const state = states.get("r1");
    expect(state?.status).toBe("refused");
    expect(state && "reason" in state ? state.reason : "").toContain("changed after the answer");
  });
});
