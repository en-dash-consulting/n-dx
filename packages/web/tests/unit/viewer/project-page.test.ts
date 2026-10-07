// @vitest-environment jsdom
/**
 * Project: analyze and plan settings and feature flags on one SettingsFrame.
 *
 * The page is dirty when any section differs from its saved values. One Save
 * sends each dirty section to its own endpoint; a section that saves becomes
 * clean, one whose write fails stays dirty and the frame names it. Feature
 * flags save on Save, not on click, and are announced only after their write
 * succeeds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ProjectView } from "../../../src/viewer/views/project.js";
import { guardedLeave } from "../../../src/viewer/hooks/use-leave-guard.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

type Json = Record<string, unknown>;

interface Request { method: string; url: string; body: Json | null }

interface Toggle {
  key: string;
  label: string;
  description: string;
  impact: string;
  package: "sourcevision" | "rex" | "hench";
  stability: "experimental" | "stable";
  enabled: boolean;
  defaultValue: boolean;
}

function toggle(key: string, label: string, pkg: Toggle["package"], enabled = false): Toggle {
  return {
    key, label, package: pkg, stability: "experimental", enabled, defaultValue: false,
    description: `${label} description`, impact: `${label} impact`,
  };
}

/**
 * Serves every API the page reads. `failures` turns a write to that URL into a
 * 500 with that message.
 */
function stubApi(opts: { failures?: Record<string, string> } = {}) {
  const requests: Request[] = [];
  const settings = { port: null as number | null, language: null as string | null, sourcevisionMergeThreshold: null as number | null, sourcevisionPins: {} as Record<string, string> };
  const toggles = [
    toggle("sourcevision.ask", "Ask", "sourcevision"),
    toggle("sourcevision.prMarkdown", "PR Markdown", "sourcevision"),
  ];
  const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) as Json : null;
    requests.push({ method, url, body });
    const failure = method !== "GET" ? opts.failures?.[url] : undefined;
    if (failure) return respond({ error: failure }, 500);

    switch (`${method} ${url}`) {
      case "GET /api/project-settings":
        return respond(settings);
      case "PUT /api/project-settings":
        if (body && "port" in body) settings.port = body["port"] as number | null;
        return respond({ applied: [], settings });
      case "GET /api/features":
        return respond({ toggles });
      case "PUT /api/features":
        for (const [key, enabled] of Object.entries((body as { changes: Record<string, boolean> }).changes)) {
          const t = toggles.find((x) => x.key === key);
          if (t) t.enabled = enabled;
        }
        return respond({ applied: [] });
      default:
        return respond({});
    }
  }));
  return { requests, writes: () => requests.filter((r) => r.method !== "GET") };
}

async function settle() {
  // Wait inside act so the state updates fetch resolutions trigger commit
  // synchronously rather than arming preact's after-paint fallback timer.
  // act renders only when it exits, and what that render mounts starts its own
  // fetches, so one round is not enough: repeat until nothing new is pending.
  for (let round = 0; round < 4; round++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

describe("ProjectView", () => {
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

  async function mount() {
    act(() => { render(h(ProjectView, null), root); });
    await settle();
  }

  // ── Queries ───────────────────────────────────────────────────────

  const titles = () => [...root.querySelectorAll(".project-section-title")].map((t) => t.textContent);
  const indicator = () => root.querySelector(".settings-frame-indicator")!.textContent;
  const saveButton = () => root.querySelector<HTMLButtonElement>(".settings-frame-save")!;
  const frameError = () => root.querySelector(".settings-frame-error")?.textContent ?? null;
  const portInput = () => root.querySelector<HTMLInputElement>("#ps-port")!;
  const flag = (label: string) => root.querySelector<HTMLInputElement>(`input[aria-label="Toggle ${label}"]`)!;

  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function flip(input: HTMLInputElement) {
    await act(async () => { input.click(); });
  }

  async function clickSave() {
    await act(async () => { saveButton().click(); });
    await settle();
  }

  /** Records `feature-toggle-changed` events for the duration of a test. */
  function recordToggleEvents() {
    const events: Array<{ key: string; enabled: boolean }> = [];
    const handler = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener("feature-toggle-changed", handler);
    return { events, stop: () => window.removeEventListener("feature-toggle-changed", handler) };
  }

  // ── Layout ────────────────────────────────────────────────────────

  it("renders inside exactly one settings frame, with no section save bar or toast", async () => {
    stubApi();
    await mount();

    expect(root.querySelectorAll(".settings-frame")).toHaveLength(1);
    expect(root.querySelectorAll(".settings-frame-save")).toHaveLength(1);
    expect(root.querySelector(".project-header-title")!.textContent).toBe("Project");
    expect(root.querySelector(".ps-save-bar")).toBeNull();
    expect(root.querySelector(".ps-toast, .ft-toast")).toBeNull();
  });

  it("shows analyze and plan settings and feature flags, and nothing else", async () => {
    stubApi();
    await mount();

    expect(titles()).toEqual(["Analyze and plan", "Feature flags"]);
  });

  it("does not render the export and refresh panels — they stay on Commands", async () => {
    stubApi();
    await mount();

    const buttons = [...root.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons.filter((t) => /\b(refresh|export)\b/i.test(t))).toEqual([]);
    expect(titles()).not.toContain("Commands");
  });

  // ── Dirty state ───────────────────────────────────────────────────

  it("is clean on load, with Save disabled", async () => {
    stubApi();
    await mount();
    expect(indicator()).toBe("All changes saved");
    expect(saveButton().disabled).toBe(true);
  });

  it("is dirty when a project setting differs from the saved value, and clean again when it is put back", async () => {
    stubApi();
    await mount();

    await type(portInput(), "4000");
    expect(indicator()).toBe("Unsaved changes");
    expect(saveButton().disabled).toBe(false);

    await type(portInput(), "");
    expect(indicator()).toBe("All changes saved");
  });

  it("is dirty when a feature flag is flipped, and clean again when it is flipped back", async () => {
    stubApi();
    await mount();

    await flip(flag("Ask"));
    expect(indicator()).toBe("Unsaved changes");
    expect(root.textContent).toContain("unsaved");

    await flip(flag("Ask"));
    expect(indicator()).toBe("All changes saved");
  });

  it("stays dirty while any one section is dirty", async () => {
    stubApi();
    await mount();

    await type(portInput(), "4000");
    await flip(flag("Ask"));
    await type(portInput(), "");
    expect(indicator()).toBe("Unsaved changes");

    await flip(flag("Ask"));
    expect(indicator()).toBe("All changes saved");
  });

  // ── Save ──────────────────────────────────────────────────────────

  it("saves a feature flag on Save, not when it is clicked", async () => {
    const { writes } = stubApi();
    await mount();

    await flip(flag("Ask"));
    expect(writes()).toEqual([]);

    await clickSave();
    expect(writes()).toEqual([{ method: "PUT", url: "/api/features", body: { changes: { "sourcevision.ask": true } } }]);
  });

  it("sends each dirty section to its own endpoint and ends clean", async () => {
    const { writes } = stubApi();
    const { events, stop } = recordToggleEvents();
    try {
      await mount();
      await type(portInput(), "4000");
      await flip(flag("Ask"));

      await clickSave();

      expect(writes()).toEqual([
        { method: "PUT", url: "/api/project-settings", body: { port: 4000 } },
        { method: "PUT", url: "/api/features", body: { changes: { "sourcevision.ask": true } } },
      ]);
      expect(indicator()).toBe("All changes saved");
      expect(frameError()).toBeNull();
      expect(portInput().value).toBe("4000");
      // Announced for the changed key only, and only once it is saved.
      expect(events).toEqual([{ key: "sourcevision.ask", enabled: true }]);
    } finally {
      stop();
    }
  });

  it("writes only the sections that are dirty", async () => {
    const { writes } = stubApi();
    await mount();

    await type(portInput(), "4000");
    await clickSave();

    expect(writes().map((w) => w.url)).toEqual(["/api/project-settings"]);
  });

  it("leaves the sections that saved clean, keeps the failed one dirty, and names it in the frame", async () => {
    const { writes } = stubApi({ failures: { "/api/features": "Features are locked" } });
    const { events, stop } = recordToggleEvents();
    try {
      await mount();
      await type(portInput(), "4000");
      await flip(flag("Ask"));

      await clickSave();

      expect(writes().map((w) => w.url)).toEqual(["/api/project-settings", "/api/features"]);
      expect(indicator()).toBe("Unsaved changes");
      expect(frameError()).toContain("feature flags");
      expect(frameError()).not.toContain("project settings");
      expect(root.textContent).toContain("Features are locked");
      // The saved section is clean: Save would now write only the flag.
      expect(portInput().value).toBe("4000");
      expect(flag("Ask").checked).toBe(true);
      // A flag that did not persist is never announced.
      expect(events).toEqual([]);

      await clickSave();
      expect(writes().map((w) => w.url)).toEqual(["/api/project-settings", "/api/features", "/api/features"]);
    } finally {
      stop();
    }
  });

  it("names every section that failed", async () => {
    stubApi({
      failures: { "/api/project-settings": "Config is read-only", "/api/features": "Features are locked" },
    });
    await mount();
    await type(portInput(), "4000");
    await flip(flag("Ask"));

    await clickSave();

    expect(frameError()).toContain("project settings");
    expect(frameError()).toContain("feature flags");
    expect(indicator()).toBe("Unsaved changes");
  });

  it("does not send an invalid port and says so", async () => {
    const { writes } = stubApi();
    await mount();

    await type(portInput(), "99999");
    await clickSave();

    expect(writes()).toEqual([]);
    expect(frameError()).toContain("project settings");
    expect(indicator()).toBe("Unsaved changes");
  });

  // ── Discard ───────────────────────────────────────────────────────

  it("restores every section when the leave prompt's Discard is chosen", async () => {
    stubApi();
    await mount();
    await type(portInput(), "4000");
    await flip(flag("Ask"));

    const leave = vi.fn();
    await act(async () => { guardedLeave(leave); });
    expect(leave).not.toHaveBeenCalled();
    await act(async () => { root.querySelector<HTMLButtonElement>(".leave-guard-discard-btn")!.click(); });

    expect(leave).toHaveBeenCalledTimes(1);
    expect(indicator()).toBe("All changes saved");
    expect(portInput().value).toBe("");
    expect(flag("Ask").checked).toBe(false);
  });
});
