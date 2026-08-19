// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { NextStepsPanel } from "../../../src/viewer/views/overview.js";
import { ArchetypeCell } from "../../../src/viewer/views/files.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("NextStepsPanel (get_next_steps UI twin)", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("renders prioritized steps from /api/sv/next-steps", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      steps: [
        { priority: "high", title: "Fix god file", description: "Split src/index.ts", category: "fix" },
        { priority: "medium", title: "Refactor utils", description: "Extract helpers", category: "refactor" },
      ],
      total: 2,
    }));

    act(() => {
      render(h(NextStepsPanel, null), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith("/api/sv/next-steps?limit=5");
    expect(root.textContent).toContain("Next Steps");
    expect(root.textContent).toContain("Fix god file");
    expect(root.textContent).toContain("Refactor utils");
    expect(root.textContent).toContain("high");
  });

  it("renders nothing when no steps are available", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: "No zones data" }));

    act(() => {
      render(h(NextStepsPanel, null), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});

    expect(root.textContent).not.toContain("Next Steps");
  });
});

describe("ArchetypeCell (set_file_archetype UI twin)", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("shows the current archetype and an edit control", () => {
    act(() => {
      render(h(ArchetypeCell, {
        path: "src/utils.ts",
        archetype: "utility",
        validArchetypes: ["utility", "entrypoint"],
      }), root);
    });
    expect(root.textContent).toContain("utility");
    expect(root.querySelector("button")).toBeTruthy();
  });

  it("POSTs the override and confirms the pending re-analyze", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, message: "Archetype override saved. Run analyze to apply." }));

    act(() => {
      render(h(ArchetypeCell, {
        path: "src/utils.ts",
        archetype: "utility",
        validArchetypes: ["utility", "entrypoint"],
      }), root);
    });

    await act(async () => {
      root.querySelector("button")!.click();
    });
    const select = root.querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();

    await act(async () => {
      select.value = "entrypoint";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/sv/archetype", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ path: "src/utils.ts", archetype: "entrypoint" }),
    }));
    expect(root.textContent).toContain("entrypoint");
    expect(root.textContent?.toLowerCase()).toContain("re-analyze");
  });

  it("surfaces a failed override", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: "Unknown archetype" }));

    act(() => {
      render(h(ArchetypeCell, {
        path: "src/utils.ts",
        archetype: "utility",
        validArchetypes: ["utility", "entrypoint"],
      }), root);
    });
    await act(async () => {
      root.querySelector("button")!.click();
    });
    const select = root.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "entrypoint";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(root.textContent).toContain("Unknown archetype");
  });
});
