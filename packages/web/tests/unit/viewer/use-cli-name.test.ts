// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render, Fragment } from "preact";
import { act } from "preact/test-utils";
import { useCliName, clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

function Probe() {
  const cliName = useCliName();
  return h(Fragment, null, h("span", { class: "probe" }, cliName));
}

describe("useCliName (shared-state CLI name accessor)", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("returns the fetched cli.name from /api/project shared state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        name: "proj", description: null, version: null, git: null,
        nameSource: "directory", cliName: "myapp",
      }),
    })));

    act(() => {
      render(h(Probe, null), root);
    });
    // Before the fetch resolves the default is visible
    expect(root.querySelector(".probe")?.textContent).toBe("n-dx");

    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});
    expect(root.querySelector(".probe")?.textContent).toBe("myapp");
  });

  it("stays 'n-dx' when the metadata fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    act(() => {
      render(h(Probe, null), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});
    expect(root.querySelector(".probe")?.textContent).toBe("n-dx");
  });
});
