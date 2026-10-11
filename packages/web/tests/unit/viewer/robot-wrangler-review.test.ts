// @vitest-environment jsdom
/**
 * Robot Wrangler Section 5: the Review modes, options and flow strip. The page
 * renders the route's `review` block and decides nothing about which modes run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RobotWranglerView } from "../../../src/viewer/views/robot-wrangler.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

type Json = Record<string, unknown>;

function review(overrides: Json = {}): Json {
  return {
    mode: { value: "off", source: "default" },
    vendor: { value: "codex", source: "default" },
    rounds: { value: 2, source: "default" },
    models: {
      claude: { model: "claude-opus-5", source: "vendor-default" },
      codex: { model: "gpt-5.5", source: "vendor-default" },
    },
    available: true,
    pairSupported: false,
    ...overrides,
  };
}

function config(overrides: Json = {}): Json {
  return {
    vendor: "claude",
    claude: { model: null, lightModel: null },
    codex: { model: null, lightModel: null },
    google: { model: null, lightModel: null },
    local: {
      model: null, lightModel: null, host: null, port: null, maxContextTokens: null, timeoutMs: null,
      verifier: { host: null, port: null, model: null, maxCycles: null },
    },
    claudeSources: {},
    agentModels: {},
    effective: { vendor: "claude", provider: "cli", model: "claude-sonnet-5", modelSource: "default" },
    effectiveProblems: [],
    tiers: [],
    review: review(),
    ...overrides,
  };
}

const READY = { state: "ready", summary: "Ready" };

const CATALOG: Json = {
  claude: { models: ["claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"], providers: ["cli", "api"], defaultModel: "claude-sonnet-5", readiness: READY },
  codex: { models: ["gpt-5.5", "gpt-5.5-mini"], providers: ["cli"], defaultModel: "gpt-5.5", readiness: { state: "needs-setup", summary: "CLI not found" } },
  google: { models: ["gemini-2.5-pro"], providers: ["api"], defaultModel: "gemini-2.5-pro", readiness: READY },
  local: { models: [], providers: ["api"], defaultModel: "", reachable: false },
};

function stubApi(initial: Json) {
  const puts: Json[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (String(url).includes("/api/llm/catalog")) return { ok: true, status: 200, json: async () => CATALOG };
    if (String(url).includes("/api/llm/config")) {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(init.body ?? "{}") as Json);
        return { ok: true, status: 200, json: async () => ({ config: initial }) };
      }
      return { ok: true, status: 200, json: async () => initial };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
  return { puts };
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

describe("Robot Wrangler review section", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mount(cfg: Json) {
    const api = stubApi(cfg);
    act(() => { render(h(RobotWranglerView, null), root); });
    await settle();
    return api;
  }

  const modeCard = (id: string) => root.querySelector<HTMLButtonElement>(`.llm-review-modes .llm-review-mode-${id}`)!;
  const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
  const save = async () => {
    await act(async () => { root.querySelector<HTMLButtonElement>(".settings-frame-save")!.click(); });
    await settle();
  };

  it("renders three mode cards with the intended copy and a Pair badge", async () => {
    await mount(config());
    const group = root.querySelector(".llm-review-modes")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(root.textContent).toContain("A second model checks each task before it commits");
    expect(modeCard("off").textContent).toContain("Commit once the tests pass.");
    expect(modeCard("self").textContent).toContain("Claude re-reads its own work on a stronger model and fixes what it finds.");
    expect(modeCard("pair").textContent).toContain("Another vendor reviews. Claude fixes the must-fix findings, then the reviewer checks again.");
    expect(modeCard("pair").querySelector(".llm-review-badge")?.textContent).toBe("Pair");
    expect(modeCard("off").getAttribute("aria-checked")).toBe("true");
  });

  it("disables Pair as Coming soon while pairSupported is false, and ignores clicks on it", async () => {
    await mount(config());
    expect(modeCard("pair").disabled).toBe(true);
    expect(modeCard("pair").textContent).toContain("Coming soon");
    expect(modeCard("self").disabled).toBe(false);
    await click(modeCard("pair"));
    expect(modeCard("off").getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("All changes saved");
  });

  it("saves hench.review.mode when Self is picked", async () => {
    const { puts } = await mount(config());
    await click(modeCard("self"));
    expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("1 unsaved change · Review mode → self");
    await save();
    expect(puts).toEqual([{ changes: { "hench.review.mode": "self" } }]);
  });

  it("saves hench.review.mode off", async () => {
    const { puts } = await mount(config({ review: review({ mode: { value: "self", source: "hench" } }) }));
    await click(modeCard("off"));
    await save();
    expect(puts).toEqual([{ changes: { "hench.review.mode": "off" } }]);
  });

  it("shows no options or flow while review is off", async () => {
    await mount(config());
    expect(root.querySelector(".llm-review-options")).toBeNull();
    expect(root.querySelector(".llm-review-flow")).toBeNull();
  });

  it("Self: shows the reviewer model note, no vendor or rounds, and a two-box flow on the reviewer model", async () => {
    await mount(config({ review: review({ mode: { value: "self", source: "hench" } }) }));
    const options = root.querySelector(".llm-review-options")!;
    expect(options.textContent).toContain("Reviewer model");
    expect(options.textContent).toContain("Resumes the work session on this model");
    expect(options.textContent).not.toContain("Reviewer vendor");
    expect(options.textContent).not.toContain("Fix rounds");
    const steps = Array.from(root.querySelectorAll(".llm-review-step")).map((s) => s.textContent);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain("does the task");
    expect(steps[0]).toContain("claude-sonnet-5");
    expect(steps[1]).toContain("claude-opus-5");
    expect(steps[1]).toContain("reviews and fixes in the same session");
  });

  it("saves the Self reviewer model as llm.<vendor>.reviewModel", async () => {
    const { puts } = await mount(config({ review: review({ mode: { value: "self", source: "hench" } }) }));
    const select = root.querySelector<HTMLSelectElement>('select[id="review.model.claude"]')!;
    await act(async () => {
      select.value = "claude-sonnet-5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await save();
    expect(puts).toEqual([{ changes: { "llm.claude.reviewModel": "claude-sonnet-5" } }]);
  });

  it("Pair: disables the executor, Gemini and Local chips with their reasons, and shows rounds", async () => {
    await mount(config({ review: review({ mode: { value: "pair", source: "hench" }, pairSupported: true }) }));
    const chips = Array.from(root.querySelectorAll<HTMLButtonElement>(".llm-review-chip"));
    const byText = (t: string) => chips.find((c) => c.textContent?.includes(t))!;
    expect(chips).toHaveLength(4);
    expect(byText("Claude").disabled).toBe(true);
    expect(byText("Claude").textContent).toContain("· executor");
    expect(byText("Gemini").disabled).toBe(true);
    expect(byText("Gemini").textContent).toContain("· no CLI");
    expect(byText("Local").disabled).toBe(true);
    expect(byText("Local").textContent).toContain("· no CLI");
    expect(byText("Codex").disabled).toBe(false);
    expect(byText("Codex").getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector(".llm-review-options")!.textContent).toContain("Saved as llm.codex.reviewModel");
    expect(root.querySelector(".llm-review-options")!.textContent)
      .toContain("How many times the executor may fix must-fix findings before the task fails review.");
  });

  it("Pair: the flow strip follows the rounds control and saves hench.review.rounds", async () => {
    const { puts } = await mount(config({ review: review({ mode: { value: "pair", source: "hench" }, pairSupported: true }) }));
    const steps = () => Array.from(root.querySelectorAll(".llm-review-step")).map((s) => s.textContent ?? "");
    expect(steps()).toHaveLength(4);
    expect(steps()[1]).toContain("Codex");
    expect(steps()[1]).toContain("reviews");
    expect(steps()[2]).toContain("fixes findings");
    expect(steps()[3]).toContain("checks the fixes · up to 2 rounds");
    const three = Array.from(root.querySelectorAll<HTMLButtonElement>(".llm-review-round")).find((b) => b.textContent === "3")!;
    await click(three);
    expect(steps()[3]).toContain("up to 3 rounds");
    await save();
    expect(puts).toEqual([{ changes: { "hench.review.rounds": "3" } }]);
  });

  it("warns that review is skipped when the reviewer is not ready", async () => {
    await mount(config({ review: review({ mode: { value: "pair", source: "hench" }, pairSupported: true }) }));
    const warning = root.querySelector(".llm-review-warning")!;
    expect(warning.textContent).toContain("Codex is not ready");
    expect(warning.textContent).toContain("Review is skipped until it is");
  });

  it("shows the unavailable reason and lets no mode be chosen", async () => {
    await mount(config({
      vendor: "google",
      effective: { vendor: "google", provider: "api", model: "gemini-2.5-pro", modelSource: "default" },
      review: review({
        mode: { value: "self", source: "hench" },
        available: false,
        unavailableReason: "Review needs a CLI on both sides, and google has no CLI.",
      }),
    }));
    expect(root.querySelector(".llm-review-unavailable")?.textContent)
      .toBe("Review needs a CLI on both sides, and google has no CLI.");
    for (const id of ["off", "self", "pair"]) {
      expect(modeCard(id).disabled).toBe(true);
      expect(modeCard(id).getAttribute("aria-checked")).toBe("false");
    }
    expect(root.querySelector(".llm-review-options")).toBeNull();
    expect(root.querySelector(".llm-review-flow")).toBeNull();
  });

  it("renders no review section when the response has no review block", async () => {
    await mount(config({ review: undefined }));
    expect(root.querySelector(".llm-review-modes")).toBeNull();
    expect(root.textContent).not.toContain("A second model checks each task");
  });

  it("holds review edits back while an unsaved vendor change is pending", async () => {
    await mount(config());
    const codexCard = root.querySelector<HTMLButtonElement>(".llm-vendor-card-codex")!;
    await click(codexCard);
    expect(root.querySelector(".llm-review-modes")).toBeNull();
    expect(root.textContent).toContain("Save the vendor change to set up review for Codex");
  });
});
