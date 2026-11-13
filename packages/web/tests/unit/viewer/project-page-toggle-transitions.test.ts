// @vitest-environment jsdom
/**
 * Project settings across a feature toggle's real off/on transition.
 *
 * `project-page.test.ts` serves the Sidecar and branch health toggles from a
 * fixed mock, which cannot change during a test. Here the real
 * `useFeatureToggle` runs: it reads GET /api/features and re-reads it when
 * the page announces a saved flag, so a Save that turns the Sidecar off really
 * hides what only the Sidecar shows — mid-save, as in the dashboard.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ProjectView } from "../../../src/viewer/views/project.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

type Json = Record<string, unknown>;

/** The server, as far as the page reads it. `failProjectSettings` makes PUT /api/project-settings answer 500. */
function stubServer(opts: { failProjectSettings?: boolean } = {}) {
  const writes: Array<{ url: string; body: Json }> = [];
  const settings = { port: null, language: null, sourcevisionMergeThreshold: null, sourcevisionPins: {}, githubReads: false };
  const toggles = [
    { key: "web.sidecar", label: "Sidecar", description: "", impact: "", package: "web", group: "connections", stability: "experimental", enabled: true, defaultValue: false },
    { key: "git.branchHealth", label: "Branch health", description: "", impact: "", package: "git", group: "connections", stability: "experimental", enabled: false, defaultValue: false },
  ];
  const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) as Json : {};
    if (method !== "GET") writes.push({ url, body });
    switch (`${method} ${url}`) {
      case "GET /api/project-settings": return respond(settings);
      case "PUT /api/project-settings":
        if (opts.failProjectSettings) return respond({ error: "The local config is read-only" }, 500);
        if ("githubReads" in body) settings.githubReads = body.githubReads === true;
        return respond({ applied: [], settings });
      case "GET /api/features": return respond({ toggles });
      case "PUT /api/features":
        for (const [key, enabled] of Object.entries((body as { changes: Record<string, boolean> }).changes)) {
          const t = toggles.find((x) => x.key === key);
          if (t) t.enabled = enabled;
        }
        return respond({ applied: [] });
      case "GET /api/connections": return respond({ connections: [] });
      default: return respond({});
    }
  }));
  return { writes };
}

async function settle() {
  for (let round = 0; round < 6; round++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

describe("Project settings across a real Sidecar off transition", () => {
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

  const switchFor = (label: string) => root.querySelector<HTMLInputElement>(`input[aria-label="Toggle ${label}"]`);
  const indicator = () => root.querySelector(".settings-frame-indicator")!.textContent;
  const alerts = () => [...root.querySelectorAll(".project-alert")].map((a) => a.textContent);

  async function editAndTurnSidecarOff() {
    act(() => { render(h(ProjectView, null), root); });
    await settle();
    expect(switchFor("GitHub reads")).not.toBeNull();
    await act(async () => { switchFor("GitHub reads")!.click(); });
    await act(async () => { switchFor("Sidecar")!.click(); });
    await act(async () => { root.querySelector<HTMLButtonElement>(".settings-frame-save")!.click(); });
    await settle();
  }

  it("keeps a GitHub reads edit whose save failed on screen, dirty and retryable, after the Sidecar goes off", async () => {
    const { writes } = stubServer({ failProjectSettings: true });
    await editAndTurnSidecarOff();

    expect(writes.map((w) => w.url)).toEqual(["/api/project-settings", "/api/features"]);
    // The Sidecar is off now; the edit and its error both survived it.
    expect(switchFor("Sidecar")!.checked).toBe(false);
    expect(switchFor("GitHub reads")!.checked).toBe(true);
    expect(indicator()).toBe("Unsaved changes");
    expect(alerts()).toContain("Project settings: The local config is read-only");
  });

  it("saves GitHub reads in the same Save that turns the Sidecar off, then hides it", async () => {
    const { writes } = stubServer();
    await editAndTurnSidecarOff();

    expect(writes).toEqual([
      { url: "/api/project-settings", body: { githubReads: true } },
      { url: "/api/features", body: { changes: { "web.sidecar": false } } },
    ]);
    expect(indicator()).toBe("All changes saved");
    // Nothing reads it any more, and nothing is pending: the row goes.
    expect(switchFor("GitHub reads")).toBeNull();
  });
});
