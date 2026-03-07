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

  it("renders compact variant when compact prop is true", () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn(), compact: true }));
    expect(root.querySelector(".smart-add-panel-compact")).toBeTruthy();
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

    // Let the fetch promise chain fully resolve
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => queueMicrotask(r));

    // Flush the re-render triggered by setState
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
