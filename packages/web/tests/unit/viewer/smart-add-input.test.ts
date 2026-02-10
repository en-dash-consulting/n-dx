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

  it("renders the smart add panel with header and textarea", () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    expect(root.textContent).toContain("Smart Add");
    expect(root.textContent).toContain("Describe what you want to build");
    expect(root.querySelector(".smart-add-textarea")).toBeTruthy();
  });

  it("shows hint when input is too short", async () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "abc");
    await flush();

    expect(root.textContent).toContain("at least 10 characters");
  });

  it("does not trigger API call for input shorter than minimum length", () => {
    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "short");

    // Advance past debounce
    vi.advanceTimersByTime(600);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("triggers debounced API call for sufficient input", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    // Should not have called fetch yet (still debouncing)
    expect(fetchSpy).not.toHaveBeenCalled();

    // Advance past debounce (500ms)
    vi.advanceTimersByTime(600);

    // Now fetch should be called
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/rex/smart-add-preview",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Verify the request body
    const call = fetchSpy.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toBe("Add user authentication with OAuth2");
  });

  it("debounces rapid input changes", () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        proposals: [],
        confidence: 0,
        qualityIssues: [],
      }),
    });

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    // Type multiple changes rapidly
    typeInTextarea(textarea, "Add user auth");
    vi.advanceTimersByTime(200);

    typeInTextarea(textarea, "Add user authentication");
    vi.advanceTimersByTime(200);

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    // Only the last input should be pending, not yet fired
    expect(fetchSpy).not.toHaveBeenCalled();

    // Advance past debounce for the last input
    vi.advanceTimersByTime(600);

    // Should only have made one fetch call (the last input)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("shows loading state while generating", async () => {
    // Create a promise that won't resolve immediately
    let resolvePromise: (value: unknown) => void;
    const pending = new Promise((r) => { resolvePromise = r; });

    fetchSpy.mockReturnValue(pending);

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    // Advance past debounce to trigger the fetch
    vi.advanceTimersByTime(600);

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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    // Advance past debounce
    vi.advanceTimersByTime(600);

    // Wait for the fetch promise to resolve and Preact to update
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();
    await flush();

    // Check confidence display
    expect(root.textContent).toContain("78%");
    expect(root.querySelector(".smart-add-confidence")).toBeTruthy();
  });

  it("shows summary stats for generated proposals", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();
    await flush();

    // Check priority badges
    expect(root.querySelector(".prd-priority-high")).toBeTruthy();
    expect(root.querySelector(".prd-priority-medium")).toBeTruthy();
  });

  it("shows acceptance criteria badge on tasks that have AC", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();
    await flush();

    expect(root.querySelector(".smart-add-quality-issues")).toBeTruthy();
    expect(root.textContent).toContain("1 quality warning");
  });

  it("resets state when input is cleared", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    // First, generate proposals
    typeInTextarea(textarea, "Add user authentication with OAuth2");
    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();
    await flush();

    expect(root.textContent).toContain("User Authentication");

    // Now clear the input
    typeInTextarea(textarea, "");
    await flush();

    // Proposals should be cleared — no preview section
    expect(root.querySelector(".smart-add-preview")).toBeFalsy();
    expect(root.querySelector(".smart-add-confidence")).toBeFalsy();
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Something that produces no results");

    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();
    await flush();

    expect(root.querySelector(".smart-add-empty")).toBeTruthy();
    expect(root.textContent).toContain("No proposals generated");
  });

  it("renders level badges for epics, features, and tasks", async () => {
    fetchSpy.mockResolvedValue(mockSuccessResponse());

    const root = renderToDiv(h(SmartAddInput, { onPrdChanged: vi.fn() }));
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();
    await flush();

    expect(root.querySelector(".prd-level-epic")).toBeTruthy();
    expect(root.querySelector(".prd-level-feature")).toBeTruthy();
    expect(root.querySelector(".prd-level-task")).toBeTruthy();
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
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
    const textarea = root.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

    typeInTextarea(textarea, "Add user authentication with OAuth2");

    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();
    await flush();

    expect(root.textContent).toContain("Low confidence");
    expect(root.querySelector(".smart-add-confidence-low")).toBeTruthy();
  });
});
