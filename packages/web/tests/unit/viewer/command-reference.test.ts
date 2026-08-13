// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { CommandReferenceView } from "../../../src/viewer/views/command-reference.js";

const MANIFEST = {
  cliName: "myapp",
  groups: [
    {
      id: "setup", label: "Setup", commands: [
        { name: "init", invocation: "myapp init", description: "Initialize project", status: "available" },
      ],
    },
    {
      id: "execution", label: "Execution", commands: [
        { name: "work", invocation: "myapp work", description: "Execute the next task", status: "needs-llm" },
        // A command the component has never heard of — must render anyway
        // (server-driven manifest contract).
        { name: "teleport", invocation: "myapp teleport", description: "Beam the repo somewhere", status: "needs-init" },
      ],
    },
  ],
};

describe("CommandReferenceView", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function renderWith(response: unknown, status = 200) {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
    })));
    act(() => {
      render(h(CommandReferenceView, null), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});
  }

  it("renders groups and rows straight from the manifest", async () => {
    await renderWith(MANIFEST);
    expect(root.textContent).toContain("Setup");
    expect(root.textContent).toContain("Execution");
    expect(root.textContent).toContain("myapp init");
    expect(root.textContent).toContain("Initialize project");
    // Unknown command renders without any component change
    expect(root.textContent).toContain("myapp teleport");
    expect(root.textContent).toContain("Beam the repo somewhere");
  });

  it("shows an accessible availability status per row", async () => {
    await renderWith(MANIFEST);
    const statuses = Array.from(root.querySelectorAll(".cmdref-status")).map((el) => el.textContent);
    expect(statuses.some((s) => s?.includes("available"))).toBe(true);
    expect(statuses.some((s) => s?.includes("needs LLM"))).toBe(true);
    expect(statuses.some((s) => s?.includes("needs init"))).toBe(true);
  });

  it("shows an error state when the manifest cannot load", async () => {
    await renderWith({ error: "boom" }, 500);
    expect(root.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
});
