// @vitest-environment jsdom
/**
 * AgentPromptSection: the editor for the project's agent prompt file. It owns
 * its Save and Discard and never mounts a SettingsFrame, so it works inside the
 * Workflow page's frame and on its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AgentPromptSection } from "../../../src/viewer/views/agent-prompt.js";
import { AgentPromptSection as FromBarrel } from "../../../src/viewer/views/domain-settings.js";

type Json = Record<string, unknown>;

const BASE = {
  path: ".ndx/agent-prompt.md",
  content: "",
  exists: false,
  bytes: 0,
  maxBytes: 32 * 1024,
  truncated: false,
  configured: false,
  warnings: [] as string[],
};

function stubApi(initial: Json = {}, opts: { putStatus?: number; putError?: string } = {}) {
  let saved = { ...BASE, ...initial };
  const puts: Json[] = [];
  const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    expect(url).toBe("/api/agent-prompt");
    if ((init?.method ?? "GET") === "PUT") {
      const body = JSON.parse(init!.body!) as Json;
      puts.push(body);
      if (opts.putStatus) return respond({ error: opts.putError ?? "nope" }, opts.putStatus);
      saved = { ...saved, content: body.content as string, exists: true, bytes: (body.content as string).length };
      return respond(saved);
    }
    return respond(saved);
  }));
  return { puts };
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

describe("AgentPromptSection", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mount(props: { compact?: boolean } = {}) {
    act(() => { render(h(AgentPromptSection, props), root); });
    await settle();
  }

  const textarea = () => root.querySelector<HTMLTextAreaElement>(".agent-prompt-input")!;
  const saveBtn = () => root.querySelector<HTMLButtonElement>(".agent-prompt-save")!;
  const discardBtn = () => root.querySelector<HTMLButtonElement>(".agent-prompt-discard")!;
  const state = () => root.querySelector(".agent-prompt-state")!.textContent;

  async function type(value: string) {
    await act(async () => {
      textarea().value = value;
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("is exported from the settings barrel", () => {
    expect(FromBarrel).toBe(AgentPromptSection);
  });

  it("shows the path, the explanation and the saved text, clean, with no frame of its own", async () => {
    stubApi({ content: "Use pnpm.", exists: true, bytes: 9 });
    await mount();

    expect(root.querySelector(".agent-prompt-path")!.textContent).toBe(".ndx/agent-prompt.md");
    expect(root.querySelector(".agent-prompt-desc")!.textContent).toContain("system prompt of every n-dx agent");
    expect(textarea().value).toBe("Use pnpm.");
    expect(state()).toBe("In use");
    expect(saveBtn().disabled).toBe(true);
    expect(discardBtn().disabled).toBe(true);
    expect(root.querySelector(".settings-frame")).toBeNull();
  });

  it("says Not set for an absent file", async () => {
    stubApi();
    await mount();
    expect(state()).toBe("Not set");
  });

  it("saves an edit with PUT and comes back clean", async () => {
    const { puts } = stubApi();
    await mount();

    await type("Never edit dist/.");
    expect(state()).toBe("Unsaved changes");
    expect(saveBtn().disabled).toBe(false);

    await act(async () => { saveBtn().click(); });
    await settle();

    expect(puts).toEqual([{ content: "Never edit dist/." }]);
    expect(state()).toBe("Saved");
    expect(saveBtn().disabled).toBe(true);
  });

  it("discards an edit back to the saved text", async () => {
    const { puts } = stubApi({ content: "Keep me", exists: true });
    await mount();

    await type("changed");
    await act(async () => { discardBtn().click(); });

    expect(textarea().value).toBe("Keep me");
    expect(state()).toBe("In use");
    expect(puts).toEqual([]);
  });

  it("shows the server's error and stays dirty when a save fails", async () => {
    stubApi({}, { putStatus: 400, putError: "agent.promptFile \"../x\" is outside the project; using the default." });
    await mount();

    await type("x");
    await act(async () => { saveBtn().click(); });
    await settle();

    expect(root.querySelector('.agent-prompt-error[role="alert"]')!.textContent).toContain("outside the project");
    expect(state()).toBe("Unsaved changes");
  });

  it("will not save text over the cap", async () => {
    stubApi({ maxBytes: 8 });
    await mount();

    await type("123456789");
    expect(saveBtn().disabled).toBe(true);
    expect(root.querySelector(".agent-prompt-size--over")).not.toBeNull();
  });

  it("shows warnings, and a truncated file read-only", async () => {
    stubApi({ content: "first part", exists: true, truncated: true, bytes: 40_000, warnings: [".ndx/agent-prompt.md is 39.1 KB; only the first 32 KB is sent to agents."] });
    await mount();

    const warnings = root.querySelector(".agent-prompt-warnings")!.textContent;
    expect(warnings).toContain("only the first 32 KB");
    expect(warnings).toContain("Edit the file directly");
    expect(textarea().readOnly).toBe(true);
  });

  it("renders a shorter editor when compact", async () => {
    stubApi();
    await mount({ compact: true });
    expect(root.querySelector(".agent-prompt--compact")).not.toBeNull();
    expect(textarea().rows).toBe(6);
  });

  it("survives a response missing fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    await mount();
    expect(textarea().value).toBe("");
    expect(state()).toBe("Not set");
  });
});
