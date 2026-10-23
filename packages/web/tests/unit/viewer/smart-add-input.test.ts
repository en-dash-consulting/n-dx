// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { SmartAddInput } from "../../../src/viewer/components/prd-tree/smart-add-input.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

/**
 * Helper to simulate typing in a Preact-controlled textarea.
 * Sets .value then dispatches an input event so Preact's onInput fires.
 */
function typeInTextarea(textarea: HTMLTextAreaElement, value: string) {
  // Preact reads event.target.value inside onInput, so we need the
  // native .value to be set before dispatching.
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, "value",
  )?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Flush microtasks and Preact batched updates. */
async function flush() {
  await new Promise<void>((r) => queueMicrotask(r));
  await new Promise<void>((r) => queueMicrotask(r));
}

/** Type text into the textarea, flush, then click the Generate button. */
async function typeAndGenerate(root: HTMLElement, text: string) {
  const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;
  typeInTextarea(textarea, text);
  await flush();
  root.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!.click();
}

// Sample proposal data matching the RawProposal interface
const sampleProposals = [
  {
    epic: { title: "User Authentication", source: "llm", description: "Authentication system" },
    features: [
      {
        title: "OAuth2 Integration",
        source: "llm",
        description: "Support third-party providers",
        tasks: [
          {
            title: "Implement OAuth2 callback handler",
            source: "llm",
            sourceFile: "",
            description: "Handle authorization code exchange",
            acceptanceCriteria: ["Handles Google OAuth2 flow", "Stores refresh token"],
            priority: "high",
            tags: ["auth"],
          },
          {
            title: "Add token refresh logic",
            source: "llm",
            sourceFile: "",
            description: "Auto-refresh expired tokens",
            priority: "medium",
          },
        ],
      },
    ],
  },
];

/** Standard mock response with proposals. */
function mockSuccessResponse(confidence = 78) {
  return {
    ok: true,
    json: () => Promise.resolve({
      proposals: sampleProposals,
      confidence,
      qualityIssues: [],
    }),
  };
}

describe("SmartAddInput", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the smart add panel with header, textarea, and generate button", () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    expect(root.textContent).toContain("Smart Add");
    expect(root.textContent).toContain("Describe what you want to build");
    expect(root.querySelector(".smart-add-textarea")).toBeTruthy();
    expect(root.querySelector(".smart-add-btn-generate")).toBeTruthy();
  });

  it("shows hint when input is too short", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "abc");
    await flush();

    expect(root.textContent).toContain("more to generate proposals");
  });

  it("does not trigger API call on typing alone", () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    // Advance well past any hypothetical debounce
    vi.advanceTimersByTime(2000);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("disables generate button when input is too short", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;
    const btn = root.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!;

    expect(btn.disabled).toBe(true);

    typeInTextarea(textarea, "short");
    await flush();

    expect(btn.disabled).toBe(true);
  });

  it("triggers API call only when Generate button is clicked", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;
    const btn = root.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");
    await flush();

    // Typing alone should not trigger preview fetch (scope load may have fired)
    const previewCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => c[0] === "/api/rex/smart-add-preview",
    );
    expect(previewCalls).toHaveLength(0);

    // Click the Generate button
    btn.click();

    const previewCallsAfter = fetchSpy.mock.calls.filter(
      (c: unknown[]) => c[0] === "/api/rex/smart-add-preview",
    );
    expect(previewCallsAfter).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/rex/smart-add-preview",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Verify the request body
    const call = previewCallsAfter[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toBe("Add user authentication with OAuth2");
  });

  it("does not trigger API call on Enter key in textarea", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");
    await flush();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    vi.advanceTimersByTime(2000);

    const previewCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => c[0] === "/api/rex/smart-add-preview",
    );
    expect(previewCalls).toHaveLength(0);
  });

  it("allows typing, pausing, editing, and resuming without API calls", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    // Type, pause, edit, resume
    typeInTextarea(textarea, "Add user auth");
    vi.advanceTimersByTime(1000);

    typeInTextarea(textarea, "Add user authentication");
    vi.advanceTimersByTime(2000);

    typeInTextarea(textarea, "Add user authentication with OAuth2");
    vi.advanceTimersByTime(5000);

    // No API calls at any point during typing
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows loading state while generating", async () => {
    // Create a promise that won't resolve immediately
    let resolvePromise: (value: unknown) => void;
    const pending = new Promise((r) => { resolvePromise = r; });

    fetchSpy.mockReturnValue(pending);

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");
    await flush();

    // Click Generate
    root.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!.click();

    // Allow setState to be called (triggerPreview sets state synchronously before await)
    await flush();

    // Should show loading indicator
    expect(root.querySelector(".smart-add-loading-badge")).toBeTruthy();
    expect(root.textContent).toContain("Generating");

    // Clean up
    resolvePromise!({
      ok: true,
      json: () => Promise.resolve({ proposals: [], confidence: 0, qualityIssues: [] }),
    });
  });

  it("displays proposal preview with hierarchy after generation", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    // Check that the proposal hierarchy is displayed
    expect(root.textContent).toContain("User Authentication");
    expect(root.textContent).toContain("OAuth2 Integration");
    expect(root.textContent).toContain("Implement OAuth2 callback handler");
    expect(root.textContent).toContain("Add token refresh logic");
  });

  it("displays confidence indicator", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    // Check confidence display
    expect(root.textContent).toContain("78%");
    expect(root.querySelector(".smart-add-confidence")).toBeTruthy();
  });

  it("shows summary stats for generated proposals", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    // Check stats (1 epic, 1 feature, 2 tasks)
    expect(root.textContent).toContain("1 epic");
    expect(root.textContent).toContain("1 feature");
    expect(root.textContent).toContain("2 tasks");
  });

  it("shows action buttons when proposals are available", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    // Check action buttons
    expect(root.querySelector(".smart-add-btn-review")).toBeTruthy();
    expect(root.querySelector(".smart-add-btn-accept")).toBeTruthy();
    expect(root.textContent).toContain("Review & Edit");
    expect(root.textContent).toContain("Accept All");
  });

  it("Accept All posts loe, loeRationale and loeConfidence from the proposal", async () => {
    const withLoe = structuredClone(sampleProposals);
    Object.assign(withLoe[0].features[0].tasks[0], {
      loe: 1.5,
      loeRationale: "Two providers, one callback",
      loeConfidence: "medium",
    });
    fetchSpy.mockImplementation(async (url: string) =>
      url === "/api/rex/proposals/accept-edited"
        ? { ok: true, json: () => Promise.resolve({}) }
        : { ok: true, json: () => Promise.resolve({ proposals: withLoe, confidence: 78, qualityIssues: [] }) },
    );

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    root.querySelector<HTMLButtonElement>(".smart-add-btn-accept")!.click();
    await vi.runAllTimersAsync();
    await flush();

    const call = fetchSpy.mock.calls.find((c) => c[0] === "/api/rex/proposals/accept-edited");
    expect(call).toBeTruthy();
    const task = JSON.parse(call![1].body).proposals[0].features[0].tasks[0];
    expect(task.loe).toBe(1.5);
    expect(task.loeRationale).toBe("Two providers, one callback");
    expect(task.loeConfidence).toBe("medium");
  });

  it("shows priority badges on tasks", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    // Check priority badges
    expect(root.querySelector(".prd-priority-high")).toBeTruthy();
    expect(root.querySelector(".prd-priority-medium")).toBeTruthy();
  });

  it("shows acceptance criteria badge on tasks that have AC", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    // Check AC badge (first task has 2 AC)
    const acBadge = root.querySelector(".smart-add-preview-ac-badge");
    expect(acBadge).toBeTruthy();
    expect(acBadge!.textContent).toContain("2 AC");
  });

  it("displays error message on API failure", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "LLM analysis failed" }),
    });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    expect(root.querySelector(".smart-add-error")).toBeTruthy();
    expect(root.textContent).toContain("LLM analysis failed");
  });

  it("shows quality warnings when present", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        proposals: sampleProposals,
        confidence: 60,
        qualityIssues: [
          { level: "warning", path: "epic:User Auth", message: "Epic title too short" },
        ],
      }),
    });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    expect(root.querySelector(".smart-add-quality-issues")).toBeTruthy();
    expect(root.textContent).toContain("1 quality warning");
  });

  it("proposals persist when input text is later edited", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    // Generate proposals
    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    expect(root.textContent).toContain("User Authentication");

    // Edit the input — proposals should remain (no auto-clear)
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;
    typeInTextarea(textarea, "Add user authentication with OAuth2 and SSO");
    await flush();

    expect(root.textContent).toContain("User Authentication");
  });

  it("shows empty state when no proposals generated", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        proposals: [],
        confidence: 0,
        qualityIssues: [],
      }),
    });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Something that produces no results");
    await vi.runAllTimersAsync();
    await flush();

    expect(root.querySelector(".smart-add-empty")).toBeTruthy();
    expect(root.textContent).toContain("No proposals generated");
  });

  it("renders level badges for epics, features, and tasks", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    expect(root.querySelector(".prd-level-epic")).toBeTruthy();
    expect(root.querySelector(".prd-level-feature")).toBeTruthy();
    expect(root.querySelector(".prd-level-task")).toBeTruthy();
  });

  it("shows character count while typing", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "hello");
    await flush();

    expect(root.textContent).toContain("5 chars");
    expect(root.querySelector(".smart-add-char-count")).toBeTruthy();
  });

  it("shows warning style on character count when below minimum", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "short");
    await flush();

    const charCount = root.querySelector(".smart-add-char-count");
    expect(charCount).toBeTruthy();
    expect(charCount!.classList.contains("smart-add-char-count-warn")).toBe(true);
  });

  it("shows example prompts when idle with no input", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    await flush();

    expect(root.textContent).toContain("Try something like:");
    expect(root.querySelector(".smart-add-examples")).toBeTruthy();
    expect(root.querySelectorAll(".smart-add-example-chip").length).toBeGreaterThan(0);
  });

  it("hides example prompts after typing", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "hello");
    await flush();

    expect(root.querySelector(".smart-add-examples")).toBeFalsy();
  });

  it("clicking an example chip fills the textarea", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    await flush();

    const chip = root.querySelector<HTMLButtonElement>(".smart-add-example-chip")!;
    expect(chip).toBeTruthy();

    chip.click();
    await flush();

    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;
    expect(textarea.value.length).toBeGreaterThan(0);
  });

  it("bar variant is one row: no header or examples, single-line input, action after Generate", () => {
    const root = renderToDiv(h(SmartAddInput, {
      onPrdChanged: vi.fn(),
      bar: true,
      barAction: h("button", { type: "button", class: "bar-action" }, "More"),
    }));
    expect(root.querySelector(".smart-add-panel-bar")).toBeTruthy();
    expect(root.querySelector(".smart-add-header")).toBeNull();
    expect(root.querySelector(".smart-add-examples")).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!.rows).toBe(1);
    const area = root.querySelector(".smart-add-input-area")!;
    expect(area.lastElementChild!.classList.contains("bar-action")).toBe(true);
  });

  it("keeps typed text when switching out of the bar variant", async () => {
    const root = document.createElement("div");
    render(h(SmartAddInput, { onPrdChanged: vi.fn(), bar: true }), root);
    typeInTextarea(root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!, "Add a CSV export to reports");
    await flush();
    render(h(SmartAddInput, { onPrdChanged: vi.fn() }), root);
    await flush();
    expect(root.querySelector(".smart-add-header")).toBeTruthy();
    expect(root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!.value).toBe("Add a CSV export to reports");
  });

  it("shows scope dropdown when PRD has epics", async () => {
    // Use real timers for this test since we need useEffect + async fetch to complete
    vi.useRealTimers();

    const localFetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/rex/prd")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            items: [
              { id: "e1", title: "Auth Epic", level: "epic", children: [
                { id: "f1", title: "Login Feature", level: "feature", children: [] },
              ]},
            ],
          }),
        });
      }
      return Promise.resolve(mockSuccessResponse());
    });
    globalThis.fetch = localFetch as unknown as typeof fetch;

    const root = document.createElement("div");

    // Use act() to properly handle async effects (useEffect + setState)
    const { act } = await import("preact/test-utils");

    await act(async () => {
      render(h(SmartAddInput, { onPrdChanged: vi.fn() }), root);
    });

    // Let the fetch promise chain fully resolve. Each wait gets its own
    // act() call (not a bare await between two act() calls, and not one
    // shared with the render above — that render's effect body isn't even
    // invoked until this act() drains at the *end* of its span, so a wait
    // added there would elapse before the effect could use it): act()'s
    // options.requestAnimationFrame/debounceRendering override only covers
    // commits that land while its own callback's promise is still pending.
    // A commit in the gap between two act() calls falls through to
    // preact's real requestAnimationFrame/setTimeout(35) after-paint
    // fallback instead — usually harmless (the real timer fires and
    // self-clears well before this file's afterAll), but under load it can
    // still be pending when this file tears down, non-deterministically
    // failing a *later* file.
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise<void>((r) => queueMicrotask(r)); });
    await act(async () => {});

    expect(root.querySelector(".smart-add-scope-select")).toBeTruthy();
    const options = root.querySelectorAll(".smart-add-scope-select option");
    // "Entire project" + 1 epic + 1 feature = 3 options
    expect(options.length).toBe(3);

    // Restore fake timers for consistency with other tests
    vi.useFakeTimers();
  });
});

describe("Confidence indicator", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows 'High confidence' for scores >= 80", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        proposals: sampleProposals,
        confidence: 90,
        qualityIssues: [],
      }),
    });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    expect(root.textContent).toContain("High confidence");
    expect(root.textContent).toContain("90%");
    expect(root.querySelector(".smart-add-confidence-high")).toBeTruthy();
  });

  it("shows 'Moderate confidence' for scores 50-79", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        proposals: sampleProposals,
        confidence: 65,
        qualityIssues: [],
      }),
    });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    expect(root.textContent).toContain("Moderate confidence");
    expect(root.querySelector(".smart-add-confidence-medium")).toBeTruthy();
  });

  it("shows 'Low confidence' for scores < 50", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        proposals: sampleProposals,
        confidence: 30,
        qualityIssues: [],
      }),
    });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));

    await typeAndGenerate(root, "Add user authentication with OAuth2");
    await vi.runAllTimersAsync();
    await flush();

    expect(root.textContent).toContain("Low confidence");
    expect(root.querySelector(".smart-add-confidence-low")).toBeTruthy();
  });
});

/**
 * On a v2 PRD the preview answers with changes, not proposals. Rendering only
 * the proposal list left the panel empty and the user with nothing to accept.
 */
describe("SmartAddInput on a v2 PRD", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  const v2Preview = {
    preview: true,
    proposals: [],
    confidence: 0,
    qualityIssues: [],
    changes: [
      {
        id: "01J9CHANGE0000000000000000",
        type: "change",
        title: "Support refunds when paying by card",
        needsPlacement: true,
        placement: {
          relation: "amends",
          shortlist: [
            { target: "01J9CAP00000000000000000000", relation: "amends", title: "Pay by card", displayId: "A1.1" },
          ],
        },
      },
    ],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function generate(root: HTMLElement) {
    await typeAndGenerate(root, "Support refunds when paying by card");
    await vi.runAllTimersAsync();
    await flush();
  }

  it("renders each change with its suggested placement", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve(v2Preview) });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    await generate(root);

    expect(root.textContent).toContain("Support refunds when paying by card");
    expect(root.textContent).toContain("Suggested placement");
    expect(root.textContent).toContain("A1.1 Pay by card");
    expect(root.textContent).toContain("Inbox");
    expect(root.textContent).toContain("1 change");
    // The v1 empty state must not claim nothing was generated.
    expect(root.textContent).not.toContain("No proposals generated");
  });

  it("accepts through smart-add-accept with the text that was previewed", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      url === "/api/rex/smart-add-accept"
        ? { ok: true, json: () => Promise.resolve({ ok: true, changes: v2Preview.changes }) }
        : { ok: true, json: () => Promise.resolve(v2Preview) },
    );
    const onPrdChanged = vi.fn();

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged }));
    await generate(root);

    root.querySelector<HTMLButtonElement>(".smart-add-btn-accept")!.click();
    await vi.runAllTimersAsync();
    await flush();

    const call = fetchSpy.mock.calls.find((c) => c[0] === "/api/rex/smart-add-accept");
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toEqual({ text: "Support refunds when paying by card" });
    // No v1 accept: that path writes epics, features and tasks.
    expect(fetchSpy.mock.calls.some((c) => c[0] === "/api/rex/proposals/accept-edited")).toBe(false);
    expect(onPrdChanged).toHaveBeenCalled();
  });

  it("says the text becomes an Inbox change, not generated proposals", () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn(), layout: "v2" }));

    expect(root.querySelector(".smart-add-title")!.textContent).toBe("Add to Inbox");
    expect(root.textContent).toContain("becomes one change in the Inbox");
    expect(root.textContent).not.toContain("Smart Add");
    expect(root.textContent).not.toMatch(/proposal/i);
    const button = root.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!;
    expect(button.textContent).toBe("Preview");
    expect(button.getAttribute("aria-label")).not.toMatch(/proposal/i);
  });

  it("never shows the proposal-generating loading text", async () => {
    fetchSpy.mockReturnValue(new Promise(() => {}));
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn(), layout: "v2" }));
    await typeAndGenerate(root, "Support refunds when paying by card");
    await flush();

    expect(root.querySelector(".smart-add-loading")).toBeTruthy();
    expect(root.textContent).not.toMatch(/proposal|Generating/i);
  });

  it("previews the cut title with the full text as its description, and names the next step", async () => {
    const full = "Shoppers paying by card want refunds they can start themselves from the order page.\n\nRefunds go back to the same card.";
    const title = "Shoppers paying by card want refunds they can start themselves from the order…";
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...v2Preview, changes: [{ ...v2Preview.changes[0], title, description: full }] }),
    });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn(), layout: "v2" }));
    await typeAndGenerate(root, full);
    await vi.runAllTimersAsync();
    await flush();

    expect(root.querySelector(".smart-add-preview-title")!.textContent).toBe(title);
    expect(root.querySelector(".smart-add-preview-full-text")!.textContent).toBe(full);
    expect(root.querySelector(".smart-add-next-step")!.textContent).toMatch(/^Next: place it on the capability/);
  });

  it("keeps the v1 Smart Add wording when the layout is v1", () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn(), layout: "v1" }));
    expect(root.querySelector(".smart-add-title")!.textContent).toBe("Smart Add");
    expect(root.querySelector(".smart-add-btn-generate")!.textContent).toBe("Generate");
  });

  it("surfaces an accept failure and keeps the preview on screen", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      url === "/api/rex/smart-add-accept"
        ? { ok: false, status: 500, json: () => Promise.resolve({ error: "lock held by pid 42" }) }
        : { ok: true, json: () => Promise.resolve(v2Preview) },
    );

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    await generate(root);

    root.querySelector<HTMLButtonElement>(".smart-add-btn-accept")!.click();
    await vi.runAllTimersAsync();
    await flush();

    expect(root.textContent).toContain("lock held by pid 42");
    expect(root.textContent).toContain("Support refunds when paying by card");
  });
});
