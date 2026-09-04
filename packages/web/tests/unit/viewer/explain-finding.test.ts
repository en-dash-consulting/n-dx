// @vitest-environment jsdom
/**
 * Explain a finding — the path from a Problems/Suggestions row to a grounded
 * Ask request.
 *
 * The property under test is end-to-end and cheap to break silently: a seed
 * that loses the finding's zone or files on the way still produces a
 * confident-looking answer, just a generic one. So the assertions follow the
 * actual values — `web-viewer`, `src/viewer/main.ts` — from the row that was
 * clicked to the body that reaches `POST /api/sourcevision/ask`, rather than
 * checking that a seed of some shape was sent.
 *
 * Coverage is split three ways because the failure modes are:
 *   1. the action is missing on some rows (severity-dependent rendering),
 *   2. the mapping drops a field,
 *   3. the panel receives the seed but does not send it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { FindingsList } from "../../../src/viewer/components/data-display/findings-list.js";
import { findingAskSeed, EXPLAIN_PROMPT } from "../../../src/viewer/views/finding-seed.js";
import { ProblemsView } from "../../../src/viewer/views/problems.js";
import { SuggestionsView } from "../../../src/viewer/views/suggestions.js";
import { AskView } from "../../../src/viewer/views/ask.js";
import type { Finding } from "../../../src/viewer/external.js";
import type { AskSeed, LoadedData, NavigateTo, ViewId } from "../../../src/viewer/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * One row of every shape the acceptance criteria name: each severity, a
 * missing severity, both finding types the two views filter on, a global
 * scope, and a row with no related files.
 */
const FINDINGS: Finding[] = [
  {
    type: "anti-pattern",
    pass: 2,
    scope: "web-viewer",
    text: "God file: src/viewer/main.ts owns routing, loading, and layout.",
    severity: "critical",
    related: ["src/viewer/main.ts", "src/viewer/route-state.ts"],
  },
  {
    type: "anti-pattern",
    pass: 2,
    scope: "web-server",
    text: "Route handlers duplicate body parsing.",
    severity: "warning",
    related: ["src/server/routes-rex.ts"],
  },
  {
    type: "anti-pattern",
    pass: 2,
    scope: "global",
    text: "Two zones share an entry point.",
    severity: "info",
  },
  {
    // No severity at all — the case AC6 calls out by name.
    type: "anti-pattern",
    pass: 2,
    scope: "web-shared",
    text: "Unclassified: shared/ has grown a residual module.",
    related: ["src/shared/index.ts"],
  },
  {
    type: "suggestion",
    pass: 2,
    scope: "web-viewer",
    text: "Extract the clipboard path into a shared util.",
    severity: "info",
    related: ["src/viewer/utils/clipboard.ts"],
  },
  {
    type: "suggestion",
    pass: 2,
    scope: "global",
    text: "Consider splitting the largest zone.",
  },
];

function loadedData(findings: Finding[]): LoadedData {
  return {
    manifest: null,
    inventory: null,
    imports: null,
    // enrichmentPass has to clear the views' own gates or they render the
    // gate card instead of a list, and no row would carry an action.
    zones: { zones: [], crossings: [], unzoned: [], findings, enrichmentPass: 9 } as unknown as LoadedData["zones"],
    components: null,
    callGraph: null,
  };
}

function mount(vnode: ReturnType<typeof h>): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(vnode, root);
  return root;
}

function explainButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button.finding-explain-btn")];
}

// ---------------------------------------------------------------------------
// 1. The action exists on every row
// ---------------------------------------------------------------------------

describe("FindingsList Explain action", () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("offers Explain on every finding row, whatever its type or severity", () => {
    root = mount(h(FindingsList, { findings: FINDINGS, onExplain: () => {}, searchable: false }));

    expect(root.querySelectorAll("li.finding-card")).toHaveLength(FINDINGS.length);
    expect(explainButtons(root)).toHaveLength(FINDINGS.length);
  });

  it("offers it on a finding with no severity set", () => {
    const unclassified = FINDINGS.filter((f) => f.severity === undefined);
    expect(unclassified.length).toBeGreaterThan(0);

    root = mount(h(FindingsList, { findings: unclassified, onExplain: () => {}, searchable: false }));
    expect(explainButtons(root)).toHaveLength(unclassified.length);
  });

  it("hands the callback the finding that was clicked", async () => {
    const seen: Finding[] = [];
    root = mount(h(FindingsList, {
      findings: FINDINGS,
      onExplain: (f: Finding) => { seen.push(f); },
      searchable: false,
    }));

    const target = explainButtons(root).find(
      (b) => b.getAttribute("aria-label")?.includes("God file"),
    );
    if (!target) throw new Error("no Explain button for the god-file finding");
    await act(async () => { target.click(); });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.scope).toBe("web-viewer");
  });

  it("renders no action at all when the surface cannot explain", () => {
    // The Architecture view passes no handler; a button that goes nowhere is
    // worse than an absent one.
    root = mount(h(FindingsList, { findings: FINDINGS, searchable: false }));
    expect(explainButtons(root)).toHaveLength(0);
  });

  it("keeps the Explain button out of the expandable header button", () => {
    // The header is a <button> whenever a finding has related files. A button
    // inside a button is invalid markup that browsers resolve unpredictably —
    // in practice the inner click can activate the outer toggle instead.
    root = mount(h(FindingsList, { findings: FINDINGS, onExplain: () => {}, searchable: false }));

    for (const button of explainButtons(root)) {
      expect(button.closest("button.finding-header-btn")).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The mapping keeps the finding's facts
// ---------------------------------------------------------------------------

describe("findingAskSeed", () => {
  it("carries type, severity, zone, message, and files as fields", () => {
    const seed = findingAskSeed(FINDINGS[0]!);

    expect(seed.kind).toBe("finding");
    expect(seed.zone).toBe("web-viewer");
    expect(seed.files).toEqual(["src/viewer/main.ts", "src/viewer/route-state.ts"]);
    expect(seed.labels).toEqual({ type: "anti-pattern", severity: "critical" });
    expect(seed.text).toBe(FINDINGS[0]!.text);
    expect(seed.id).toBeTruthy();
  });

  it("omits severity rather than defaulting it when the analysis set none", () => {
    const unclassified = FINDINGS.find((f) => f.severity === undefined);
    if (!unclassified) throw new Error("fixture lost its unclassified finding");

    const seed = findingAskSeed(unclassified);
    expect(seed.labels).toEqual({ type: "anti-pattern" });
    // The list view groups a missing severity under "info"; telling the model
    // the analysis classified it that way would be inventing a fact, and
    // severity is exactly what an explanation reasons about.
    expect(JSON.stringify(seed)).not.toContain("info");
  });

  it("omits the zone for a global finding instead of naming 'global' as one", () => {
    const globalFinding = FINDINGS.find((f) => f.scope === "global");
    if (!globalFinding) throw new Error("fixture lost its global finding");

    const seed = findingAskSeed(globalFinding);
    expect(seed.zone).toBeUndefined();
  });

  it("omits files when the finding names none", () => {
    const noFiles = FINDINGS.find((f) => f.related === undefined);
    if (!noFiles) throw new Error("fixture lost its file-less finding");

    expect(findingAskSeed(noFiles).files).toBeUndefined();
  });

  it("gives two different findings two different identifiers", () => {
    const ids = new Set(FINDINGS.map((f) => findingAskSeed(f).id));
    expect(ids.size).toBe(FINDINGS.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Both views navigate to Ask with the seed attached
// ---------------------------------------------------------------------------

describe("Explain from the Problems and Suggestions views", () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  function captureNavigation(): { calls: Array<{ view: ViewId; seed: AskSeed | undefined }>; navigateTo: NavigateTo } {
    const calls: Array<{ view: ViewId; seed: AskSeed | undefined }> = [];
    const navigateTo: NavigateTo = (view, opts) => { calls.push({ view, seed: opts?.askSeed }); };
    return { calls, navigateTo };
  }

  it("Problems sends the clicked anti-pattern to the Ask view", async () => {
    const { calls, navigateTo } = captureNavigation();
    root = mount(h(ProblemsView, { data: loadedData(FINDINGS), navigateTo }));

    const target = explainButtons(root).find(
      (b) => b.getAttribute("aria-label")?.includes("God file"),
    );
    if (!target) throw new Error("Problems rendered no Explain button for the god-file finding");
    await act(async () => { target.click(); });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.view).toBe("ask");
    expect(calls[0]?.seed?.zone).toBe("web-viewer");
    expect(calls[0]?.seed?.files).toContain("src/viewer/main.ts");
  });

  it("Suggestions sends the clicked suggestion to the Ask view", async () => {
    const { calls, navigateTo } = captureNavigation();
    root = mount(h(SuggestionsView, { data: loadedData(FINDINGS), navigateTo }));

    const target = explainButtons(root).find(
      (b) => b.getAttribute("aria-label")?.includes("clipboard"),
    );
    if (!target) throw new Error("Suggestions rendered no Explain button for the clipboard finding");
    await act(async () => { target.click(); });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.view).toBe("ask");
    expect(calls[0]?.seed?.labels).toEqual({ type: "suggestion", severity: "info" });
    expect(calls[0]?.seed?.files).toEqual(["src/viewer/utils/clipboard.ts"]);
  });

  it("offers Explain on every row each view shows", () => {
    const { navigateTo } = captureNavigation();

    root = mount(h(ProblemsView, { data: loadedData(FINDINGS), navigateTo }));
    const problemRows = root.querySelectorAll("li.finding-card").length;
    expect(problemRows).toBe(FINDINGS.filter((f) => f.type === "anti-pattern").length);
    expect(explainButtons(root)).toHaveLength(problemRows);

    render(null, root);
    root.remove();

    root = mount(h(SuggestionsView, { data: loadedData(FINDINGS), navigateTo }));
    const suggestionRows = root.querySelectorAll("li.finding-card").length;
    expect(suggestionRows).toBe(FINDINGS.filter((f) => f.type === "suggestion").length);
    expect(explainButtons(root)).toHaveLength(suggestionRows);
  });
});

// ---------------------------------------------------------------------------
// 4. The panel sends the seed to the endpoint
// ---------------------------------------------------------------------------

describe("AskView with a seed", () => {
  let root: HTMLElement;
  let fetchSpy: ReturnType<typeof vi.fn>;

  /** Let the mounted effects and the fetch promise chain settle. */
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }

  beforeEach(() => {
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("capture")
        ? { item: { id: "i1", title: "Explained finding" }, parent: { title: "SourceVision" } }
        : { answer: "main.ts is doing three jobs.", vendor: "claude", model: "m", contextSources: ["zones.json"] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  /** Body of the nth POST to the Ask endpoint. */
  function askBody(n = 0): { prompt: string; seed?: AskSeed } {
    const calls = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/api/sourcevision/ask"));
    const init = calls[n]?.[1] as RequestInit | undefined;
    if (!init?.body) throw new Error(`no Ask request at index ${n}`);
    return JSON.parse(String(init.body));
  }

  async function submitForm(): Promise<void> {
    const form = root.querySelector<HTMLFormElement>("form.sv-ask-form");
    if (!form) throw new Error("form not rendered");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  it("pre-fills a short question rather than a prose prompt carrying the finding", () => {
    root = mount(h(AskView, { seed: findingAskSeed(FINDINGS[0]!) }));

    const textarea = root.querySelector<HTMLTextAreaElement>("textarea.sv-ask-textarea");
    expect(textarea?.value).toBe(EXPLAIN_PROMPT);
    // The finding's own text is context, not question: if it were in the
    // textarea, editing the question would delete the grounding.
    expect(textarea?.value).not.toContain("God file");
    expect(textarea?.value).not.toContain("web-viewer");
  });

  /**
   * AC7. The seed reaches the endpoint with the finding's zone and files
   * intact — asserted on the request body, which is the last point the viewer
   * controls.
   */
  it("sends the seed alongside the prompt with zone and files intact", async () => {
    root = mount(h(AskView, { seed: findingAskSeed(FINDINGS[0]!) }));
    await submitForm();

    const body = askBody();
    expect(body.prompt).toBe(EXPLAIN_PROMPT);
    expect(body.seed?.kind).toBe("finding");
    expect(body.seed?.zone).toBe("web-viewer");
    expect(body.seed?.files).toEqual(["src/viewer/main.ts", "src/viewer/route-state.ts"]);
    expect(body.seed?.labels).toEqual({ type: "anti-pattern", severity: "critical" });
    expect(body.seed?.text).toBe(FINDINGS[0]!.text);
  });

  it("sends a seed for a finding with no severity and no files", async () => {
    const globalNoSeverity = FINDINGS.find((f) => f.scope === "global" && f.severity === undefined);
    if (!globalNoSeverity) throw new Error("fixture lost its unclassified global finding");

    root = mount(h(AskView, { seed: findingAskSeed(globalNoSeverity) }));
    await submitForm();

    const body = askBody();
    expect(body.seed?.labels).toEqual({ type: "suggestion" });
    expect(body.seed).not.toHaveProperty("zone");
    expect(body.seed).not.toHaveProperty("files");
  });

  it("shows the seeded finding so the answer's specificity is legible", () => {
    root = mount(h(AskView, { seed: findingAskSeed(FINDINGS[0]!) }));

    const card = root.querySelector(".sv-ask-seed");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("God file");
    expect(card?.textContent).toContain("web-viewer");
    expect(card?.textContent).toContain("src/viewer/main.ts");
  });

  it("sends no seed once the user detaches it", async () => {
    root = mount(h(AskView, { seed: findingAskSeed(FINDINGS[0]!) }));

    const detach = root.querySelector<HTMLButtonElement>("button.sv-ask-seed-clear-btn");
    if (!detach) throw new Error("no detach control on the seed card");
    await act(async () => { detach.click(); });

    expect(root.querySelector(".sv-ask-seed")).toBeNull();
    await submitForm();
    expect(askBody()).not.toHaveProperty("seed");
  });

  it("keeps the seed attached when the user rewords the question", async () => {
    root = mount(h(AskView, { seed: findingAskSeed(FINDINGS[0]!) }));

    const textarea = root.querySelector<HTMLTextAreaElement>("textarea.sv-ask-textarea");
    if (!textarea) throw new Error("prompt textarea not rendered");
    await act(async () => {
      textarea.value = "What would fixing this touch?";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm();

    const body = askBody();
    expect(body.prompt).toBe("What would fixing this touch?");
    expect(body.seed?.zone).toBe("web-viewer");
  });

  it("replaces the exchange when a second finding is explained", async () => {
    root = mount(h(AskView, { seed: findingAskSeed(FINDINGS[0]!) }));
    await submitForm();
    expect(root.querySelector(".sv-ask-answer")).not.toBeNull();

    // Arriving from another row re-renders the panel with a new seed. The
    // previous answer is about the previous finding; leaving it on screen
    // under the new one would misattribute it.
    await act(async () => {
      render(h(AskView, { seed: findingAskSeed(FINDINGS[1]!) }), root);
    });
    await settle();

    expect(root.querySelector(".sv-ask-answer")).toBeNull();
    expect(root.querySelector(".sv-ask-seed")?.textContent).toContain("web-server");

    await submitForm();
    expect(askBody(1).seed?.zone).toBe("web-server");
  });

  /** AC5 — a seeded answer is an answer, with the same actions on it. */
  it("offers Copy and Capture on a seeded answer", async () => {
    root = mount(h(AskView, { seed: findingAskSeed(FINDINGS[0]!) }));
    await submitForm();

    expect(root.querySelector("button.sv-ask-copy-btn")).not.toBeNull();

    const capture = root.querySelector<HTMLButtonElement>("button.sv-ask-capture-btn");
    if (!capture) throw new Error("no capture control on a seeded answer");
    await act(async () => { capture.click(); });

    const confirm = root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn");
    if (!confirm) throw new Error("capture did not arm");
    await act(async () => { confirm.click(); });
    await settle();

    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/api/rex/capture-ask"))).toBe(true);
    expect(root.querySelector(".sv-ask-capture-feedback")?.textContent).toContain("Explained finding");
  });
});
