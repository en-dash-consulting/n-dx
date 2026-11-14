// @vitest-environment jsdom
/**
 * Project: every setting is one row, in a section named for what it changes,
 * all on one SettingsFrame.
 *
 * The page is dirty when any form differs from its saved values. One Save
 * sends each dirty form to its own endpoint; a form that saves becomes clean,
 * one whose write fails stays dirty and the frame names it. Feature flags save
 * on Save, not on click, and are announced only after their write succeeds.
 * A search box filters the rows; the Settings overlay lists the sections.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
// The Sidecar and branch health toggles are read through a hook that resolves
// after a fetch; they are served synchronously here so the Connections rows
// render deterministically.
const sidecar = vi.hoisted(() => ({ on: false, branchHealth: false }));
vi.mock("../../../src/viewer/hooks/use-feature-toggle.js", () => ({
  useFeatureToggle: (key: string, fallback: boolean) =>
    key === "web.sidecar" ? sidecar.on : key === "git.branchHealth" ? sidecar.branchHealth : fallback,
}));

import { ProjectView } from "../../../src/viewer/views/project.js";
import { SettingsOverlay } from "../../../src/viewer/components/settings-overlay.js";
import { guardedLeave } from "../../../src/viewer/hooks/use-leave-guard.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { FeatureToggle } from "../../../src/shared/features.js";
import type { ViewId } from "../../../src/viewer/types.js";

type Json = Record<string, unknown>;

interface Request { method: string; url: string; body: Json | null }

function toggle(key: string, label: string, group: FeatureToggle["group"], extra: Partial<FeatureToggle> = {}): FeatureToggle {
  return {
    key, label, package: key.split(".")[0] as FeatureToggle["package"], group,
    stability: "experimental", enabled: false, defaultValue: false,
    description: `${label} description`, impact: `${label} impact`,
    ...extra,
  };
}

/**
 * Serves every API the page reads. `failures` turns a write to that URL into a
 * 500 with that message.
 */
function stubApi(opts: { failures?: Record<string, string>; sidecar?: boolean; branchHealth?: boolean; pins?: Record<string, string>; githubReadsHeld?: boolean; githubReadsError?: string } = {}) {
  sidecar.on = opts.sidecar ?? false;
  sidecar.branchHealth = opts.branchHealth ?? false;
  const requests: Request[] = [];
  const settings = {
    port: null as number | null,
    language: null as string | null,
    sourcevisionMergeThreshold: null as number | null,
    sourcevisionPins: opts.pins ?? {} as Record<string, string>,
    githubReads: false,
    githubReadsError: opts.githubReadsError ?? null,
  };
  const toggles = [
    toggle("sourcevision.ask", "Ask", "optional", { costsTokens: true }),
    toggle("rex.placementDraft", "Draft placement", "optional", { costsTokens: true }),
    toggle("git.failForward", "Fail-forward mode", "git", { stability: "stable" }),
    toggle("rex.showTokenBudget", "Show Token Budget", "display", { stability: "stable", enabled: true }),
    toggle("web.sidecar", "Sidecar", "connections", { enabled: opts.sidecar ?? false }),
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
        // Held: the server keeps reporting off, as for a tracked local config in an untrusted checkout.
        if (body && "githubReads" in body && !opts.githubReadsHeld) settings.githubReads = body["githubReads"] === true;
        return respond({ applied: [], settings });
      case "GET /api/features":
        return respond({ toggles });
      case "PUT /api/features":
        for (const [key, enabled] of Object.entries((body as { changes: Record<string, boolean> }).changes)) {
          const t = toggles.find((x) => x.key === key);
          if (t) t.enabled = enabled;
        }
        return respond({ applied: [] });
      case "GET /api/connections":
        return respond({ connections: [] });
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

  /** A search hides what it leaves out rather than unmounting it. */
  const shown = (el: Element) => el.closest("[hidden]") === null;
  const titles = () => [...root.querySelectorAll(".project-section-title")].filter(shown).map((t) => t.textContent);
  const indicator = () => root.querySelector(".settings-frame-indicator")!.textContent;
  const saveButton = () => root.querySelector<HTMLButtonElement>(".settings-frame-save")!;
  const frameError = () => root.querySelector(".settings-frame-error")?.textContent ?? null;
  const portInput = () => root.querySelector<HTMLInputElement>("#ps-port")!;
  const flag = (label: string) => root.querySelector<HTMLInputElement>(`input[aria-label="Toggle ${label}"]`)!;
  const row = (key: string) => root.querySelector<HTMLElement>(`.srow[data-key="${key}"]`);
  const keysIn = (title: string) => {
    const section = [...root.querySelectorAll("section.project-section")].find((s) => s.querySelector("h2")?.textContent === title);
    return [...(section?.querySelectorAll<HTMLElement>(".srow") ?? [])].filter(shown).map((r) => r.dataset.key);
  };
  const search = () => root.querySelector<HTMLInputElement>("#project-search")!;

  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function click(el: HTMLElement) {
    await act(async () => { el.click(); });
  }

  async function clickSave() {
    await click(saveButton());
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

  it("groups settings by what they change, not by package", async () => {
    stubApi();
    await mount();

    expect(titles()).toEqual(["Analysis", "Dashboard", "Git and commits", "Display", "Optional features", "Connections"]);
    expect(keysIn("Analysis")).toEqual(["language", "sourcevision.zones.mergeThreshold", "sourcevision.zones.pins"]);
    expect(keysIn("Dashboard")).toEqual(["web.port"]);
    expect(keysIn("Git and commits")).toEqual(["features.git.failForward"]);
    expect(keysIn("Display")).toEqual(["features.rex.showTokenBudget"]);
    expect(keysIn("Optional features")).toEqual(["features.sourcevision.ask", "features.rex.placementDraft"]);
    // With the Sidecar off, Connections holds only its switch.
    expect(keysIn("Connections")).toEqual(["features.web.sidecar"]);
  });

  it("drops the stats bar and the stability legend", async () => {
    stubApi();
    await mount();
    expect(root.querySelector(".ft-stats, .ft-legend")).toBeNull();
    expect(root.textContent).not.toContain("Stability Levels");
  });

  it("does not render the export and refresh panels — they stay on Commands", async () => {
    stubApi();
    await mount();

    const buttons = [...root.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons.filter((t) => /\b(refresh|export)\b/i.test(t))).toEqual([]);
    expect(titles()).not.toContain("Commands");
  });

  // ── Rows ──────────────────────────────────────────────────────────

  it("shows each row's label, description, config key and tags, with cost and impact behind the info button", async () => {
    stubApi();
    await mount();

    const ask = row("features.sourcevision.ask")!;
    expect(ask.querySelector(".srow-label")!.textContent).toBe("Ask");
    expect(ask.querySelector(".srow-desc")!.textContent).toBe("Ask description");
    expect(ask.querySelector("code.srow-key")!.textContent).toBe("features.sourcevision.ask");
    expect([...ask.querySelectorAll(".srow-tag")].map((t) => t.textContent)).toEqual(["Tokens", "Experimental"]);
    expect(ask.textContent).not.toContain("Ask impact");

    const info = ask.querySelector<HTMLButtonElement>("button.srow-info")!;
    expect(info.getAttribute("aria-label")).toBe("More about Ask");
    await click(info);
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(ask.querySelector(".srow-details")!.textContent).toContain("Ask impact");

    expect([...row("web.port")!.querySelectorAll(".srow-tag")].map((t) => t.textContent)).toEqual(["Restart"]);
  });

  it("shows fail-forward and the token budget as ordinary settings, not experiments", async () => {
    stubApi();
    await mount();
    for (const key of ["features.git.failForward", "features.rex.showTokenBudget"]) {
      expect(row(key)!.querySelector(".srow-tag--experimental"), key).toBeNull();
    }
  });

  it("names every control for assistive technology and reaches it by keyboard", async () => {
    stubApi();
    await mount();

    for (const el of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
      const named = el.getAttribute("aria-label")
        ?? (el.id ? root.querySelector(`label[for="${el.id}"]`)?.textContent : null);
      expect(named, el.outerHTML).toBeTruthy();
      expect(el.tabIndex, el.outerHTML).toBeGreaterThanOrEqual(0);
    }
    expect(flag("Ask").getAttribute("role")).toBe("switch");
  });

  it("offers every project language n-dx supports, and saves the one picked", async () => {
    const { writes } = stubApi();
    await mount();

    const select = root.querySelector<HTMLSelectElement>("#ps-language")!;
    expect([...select.options].map((o) => o.textContent)).toEqual(
      ["Auto-detect", "TypeScript", "JavaScript", "Go", "Swift", "Python", "C#", "Java", "PHP"]);
    await act(async () => {
      select.value = "python";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await clickSave();
    expect(writes()).toEqual([{ method: "PUT", url: "/api/project-settings", body: { language: "python" } }]);
  });

  it("collapses zone pins to a count and opens the table in place", async () => {
    stubApi({ pins: { "src/a.ts": "web", "src/b.ts": "core" } });
    await mount();

    const pins = row("sourcevision.zones.pins")!;
    expect(pins.querySelector(".srow-value")!.textContent).toBe("2 pins");
    expect(pins.querySelector(".ps-pin-table")).toBeNull();

    const edit = pins.querySelector<HTMLButtonElement>("button.srow-button")!;
    await click(edit);
    expect(edit.textContent).toBe("Done");
    expect(pins.querySelectorAll(".ps-pin-table tbody tr")).toHaveLength(2);
  });

  it("resets a setting to its default, which Save then writes", async () => {
    const { writes } = stubApi();
    await mount();

    // The token budget column is on; its default is off.
    await click(row("features.rex.showTokenBudget")!.querySelector<HTMLButtonElement>("button.srow-reset")!);
    expect(flag("Show Token Budget").checked).toBe(false);
    expect(indicator()).toBe("Unsaved changes");
    expect(row("features.rex.showTokenBudget")!.querySelector("button.srow-reset")).toBeNull();
    // A setting already at its default offers no reset.
    expect(row("features.sourcevision.ask")!.querySelector("button.srow-reset")).toBeNull();

    await clickSave();
    expect(writes()).toEqual([{ method: "PUT", url: "/api/features", body: { changes: { "rex.showTokenBudget": false } } }]);
  });

  // ── Search ────────────────────────────────────────────────────────

  it("filters rows by label, description or config key and hides empty sections", async () => {
    stubApi();
    await mount();

    await type(search(), "port");
    expect(titles()).toEqual(["Dashboard"]);

    await type(search(), "failForward");
    expect(titles()).toEqual(["Git and commits"]);

    await type(search(), "draft description");
    expect(keysIn("Optional features")).toEqual(["features.rex.placementDraft"]);

    await type(search(), "");
    expect(titles()).toHaveLength(6);
  });

  it("says so when nothing matches", async () => {
    stubApi();
    await mount();

    await type(search(), "zzz-nothing");
    expect(titles()).toEqual([]);
    expect(root.querySelector('.project-search-status[role="status"]')!.textContent).toBe("No settings match “zzz-nothing”.");
  });

  it("keeps an edit made before a search, and Save still writes it", async () => {
    const { writes } = stubApi();
    await mount();

    await type(portInput(), "4000");
    await type(search(), "ask");
    expect(shown(row("web.port")!)).toBe(false);
    expect(indicator()).toBe("Unsaved changes");

    await clickSave();
    expect(writes()).toEqual([{ method: "PUT", url: "/api/project-settings", body: { port: 4000 } }]);
  });

  it("keeps an open editor open when a search hides it and is cleared", async () => {
    stubApi({ pins: { "src/a.ts": "web" } });
    await mount();

    await click(row("sourcevision.zones.pins")!.querySelector<HTMLButtonElement>("button.srow-button")!);
    expect(row("sourcevision.zones.pins")!.querySelector(".ps-pin-table")).not.toBeNull();

    await type(search(), "port");
    await type(search(), "");
    expect(row("sourcevision.zones.pins")!.querySelector(".ps-pin-table")).not.toBeNull();
  });

  it("clears the search on Escape without letting it close Settings", async () => {
    stubApi();
    await mount();
    const closed = vi.fn();
    window.addEventListener("keydown", closed);
    try {
      await type(search(), "port");
      await act(async () => {
        search().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(search().value).toBe("");
      expect(titles()).toHaveLength(6);
      expect(closed).not.toHaveBeenCalled();

      // With nothing to clear, Escape goes on to the overlay as before.
      await act(async () => {
        search().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", closed);
    }
  });

  it("hands focus to the control when Reset removes itself", async () => {
    stubApi();
    await mount();
    await type(portInput(), "4000");
    const reset = row("web.port")!.querySelector<HTMLButtonElement>("button.srow-reset")!;
    reset.focus();

    await click(reset);
    expect(row("web.port")!.querySelector("button.srow-reset")).toBeNull();
    expect(document.activeElement).toBe(portInput());
  });

  it("locks the page while Save runs, so an edit cannot slip in and be cleared unsaved", async () => {
    stubApi();
    await mount();
    await click(flag("Ask"));

    let release: (() => void) | undefined;
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") await new Promise<void>((r) => { release = r; });
      return original(url, init as never);
    }));
    act(() => { saveButton().click(); });
    const container = root.querySelector<HTMLElement>(".project-container")!;
    // jsdom has no inert property, so Preact writes the attribute; browsers get the property.
    expect(container.inert === true || container.hasAttribute("inert")).toBe(true);
    expect(container.getAttribute("aria-busy")).toBe("true");

    // The PUT starts once the clean parts ahead of it have resolved.
    await act(async () => {
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      release!();
    });
    await settle();
    expect(container.inert === true || container.hasAttribute("inert")).toBe(false);
  });

  // ── Connections ───────────────────────────────────────────────────

  it("shows GitHub reads and the MCP servers under Connections while the Sidecar is on", async () => {
    stubApi({ sidecar: true });
    await mount();
    expect(keysIn("Connections")).toEqual(["features.web.sidecar", "web.sidecarGithubReads", "connections"]);
  });

  it("asks nothing of the Sidecar routes while the Sidecar is off", async () => {
    const { requests } = stubApi();
    await mount();
    expect(requests.some((r) => r.url.startsWith("/api/sidecar") || r.url.startsWith("/api/connections"))).toBe(false);
  });

  it("saves GitHub reads through the project settings route on Save", async () => {
    const { writes } = stubApi({ sidecar: true });
    await mount();

    await click(flag("GitHub reads"));
    expect(indicator()).toBe("Unsaved changes");
    expect(writes()).toEqual([]);

    await clickSave();
    expect(writes()).toEqual([{ method: "PUT", url: "/api/project-settings", body: { githubReads: true } }]);
    expect(indicator()).toBe("All changes saved");
  });

  it("shows the GitHub reads value in force, and says so when it differs from the one saved", async () => {
    const { writes } = stubApi({ sidecar: true, githubReadsHeld: true });
    await mount();

    await click(flag("GitHub reads"));
    await clickSave();

    expect(writes()).toEqual([{ method: "PUT", url: "/api/project-settings", body: { githubReads: true } }]);
    expect(flag("GitHub reads").checked).toBe(false);
    expect(indicator()).toBe("All changes saved");
    expect(root.querySelector(".project-alert")!.textContent).toMatch(/^Project settings: Saved, but GitHub reads are still off/);
  });

  it("offers GitHub reads while only branch health uses it, and saves it without the Sidecar", async () => {
    const { writes } = stubApi({ branchHealth: true });
    await mount();

    expect(keysIn("Connections")).toEqual(["features.web.sidecar", "web.sidecarGithubReads"]);
    await click(flag("GitHub reads"));
    await clickSave();
    expect(writes()).toEqual([{ method: "PUT", url: "/api/project-settings", body: { githubReads: true } }]);
    expect(flag("GitHub reads").checked).toBe(true);
  });

  it("keeps the other settings when GitHub reads cannot be read, and shows why on its row", async () => {
    const reason = "GitHub reads could not be read from the project config: Unexpected token b in JSON at position 1";
    const { writes } = stubApi({ branchHealth: true, githubReadsError: reason });
    await mount();

    expect(row("language")).not.toBeNull();
    expect(row("web.port")).not.toBeNull();
    expect(flag("GitHub reads").checked).toBe(false);
    expect(flag("GitHub reads").disabled).toBe(true);
    expect(row("web.sidecarGithubReads")!.querySelector("#ps-github-reads-error")!.textContent).toBe(reason);
    await click(flag("GitHub reads"));
    expect(writes()).toEqual([]);
  });

  it("hides GitHub reads while neither the Sidecar nor branch health reads it", async () => {
    stubApi();
    await mount();
    expect(row("web.sidecarGithubReads")).toBeNull();
  });

  it("saves GitHub reads alongside a Save that turns the Sidecar off", async () => {
    const { writes } = stubApi({ sidecar: true });
    await mount();

    await click(flag("GitHub reads"));
    await click(flag("Sidecar"));
    await clickSave();

    expect(writes().map((w) => w.url)).toEqual(["/api/project-settings", "/api/features"]);
    expect(frameError()).toBeNull();
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
    expect(row("web.port")!.querySelector(".srow-dot")).not.toBeNull();

    await type(portInput(), "");
    expect(indicator()).toBe("All changes saved");
    expect(row("web.port")!.querySelector(".srow-dot")).toBeNull();
  });

  it("is dirty when a feature flag is flipped, and clean again when it is flipped back", async () => {
    stubApi();
    await mount();

    await click(flag("Ask"));
    expect(indicator()).toBe("Unsaved changes");
    expect(row("features.sourcevision.ask")!.textContent).toContain("unsaved");

    await click(flag("Ask"));
    expect(indicator()).toBe("All changes saved");
  });

  it("stays dirty while any one form is dirty", async () => {
    stubApi();
    await mount();

    await type(portInput(), "4000");
    await click(flag("Ask"));
    await type(portInput(), "");
    expect(indicator()).toBe("Unsaved changes");

    await click(flag("Ask"));
    expect(indicator()).toBe("All changes saved");
  });

  // ── Save ──────────────────────────────────────────────────────────

  it("saves a feature flag on Save, not when it is clicked", async () => {
    const { writes } = stubApi();
    await mount();

    await click(flag("Ask"));
    expect(writes()).toEqual([]);

    await clickSave();
    expect(writes()).toEqual([{ method: "PUT", url: "/api/features", body: { changes: { "sourcevision.ask": true } } }]);
  });

  it("sends each dirty form to its own endpoint and ends clean", async () => {
    const { writes } = stubApi();
    const { events, stop } = recordToggleEvents();
    try {
      await mount();
      await type(portInput(), "4000");
      await click(flag("Ask"));

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

  it("writes only the forms that are dirty", async () => {
    const { writes } = stubApi();
    await mount();

    await type(portInput(), "4000");
    await clickSave();

    expect(writes().map((w) => w.url)).toEqual(["/api/project-settings"]);
  });

  it("leaves the forms that saved clean, keeps the failed one dirty, and names it in the frame", async () => {
    const { writes } = stubApi({ failures: { "/api/features": "Features are locked" } });
    const { events, stop } = recordToggleEvents();
    try {
      await mount();
      await type(portInput(), "4000");
      await click(flag("Ask"));

      await clickSave();

      expect(writes().map((w) => w.url)).toEqual(["/api/project-settings", "/api/features"]);
      expect(indicator()).toBe("Unsaved changes");
      expect(frameError()).toContain("feature flags");
      expect(frameError()).not.toContain("project settings");
      expect(root.querySelector('.project-alert[role="alert"]')!.textContent).toBe("Feature flags: Features are locked");
      // The saved form is clean: Save would now write only the flag.
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

  it("names every form that failed", async () => {
    stubApi({
      failures: { "/api/project-settings": "Config is read-only", "/api/features": "Features are locked" },
    });
    await mount();
    await type(portInput(), "4000");
    await click(flag("Ask"));

    await clickSave();

    expect(frameError()).toContain("project settings");
    expect(frameError()).toContain("feature flags");
    expect(indicator()).toBe("Unsaved changes");
    expect([...root.querySelectorAll(".project-alert")].map((a) => a.textContent)).toEqual([
      "Project settings: Config is read-only",
      "Feature flags: Features are locked",
    ]);
  });

  it("does not send an invalid port and says so", async () => {
    const { writes } = stubApi();
    await mount();

    await type(portInput(), "99999");
    await clickSave();

    expect(writes()).toEqual([]);
    expect(frameError()).toContain("project settings");
    expect(indicator()).toBe("Unsaved changes");
    expect(portInput().getAttribute("aria-describedby")).toBe("ps-port-error");
  });

  // ── Discard ───────────────────────────────────────────────────────

  it("restores every form when the leave prompt's Discard is chosen", async () => {
    stubApi({ sidecar: true });
    await mount();
    await type(portInput(), "4000");
    await click(flag("Ask"));
    await click(flag("GitHub reads"));

    const leave = vi.fn();
    await act(async () => { guardedLeave(leave); });
    expect(leave).not.toHaveBeenCalled();
    await click(root.querySelector<HTMLButtonElement>(".leave-guard-discard-btn")!);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(indicator()).toBe("All changes saved");
    expect(portInput().value).toBe("");
    expect(flag("Ask").checked).toBe(false);
    expect(flag("GitHub reads").checked).toBe(false);
  });
});

// ── Section nav in the Settings overlay ─────────────────────────────

describe("Project sections in the Settings overlay nav", () => {
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

  async function mountInOverlay() {
    const views = new Set<ViewId>(["robot-wrangler", "project", "workflow", "commands"]);
    act(() => {
      render(h(SettingsOverlay, { view: "project", validViews: views, onNavigate: () => {}, onClose: () => {} },
        h(ProjectView, null)), root);
    });
    await settle();
  }

  const navSections = () => [...root.querySelectorAll<HTMLButtonElement>(".settings-overlay-section")];

  it("lists Project's sections under its entry, the first current", async () => {
    stubApi();
    await mountInOverlay();

    expect(navSections().map((b) => b.textContent)).toEqual(
      ["Analysis", "Dashboard", "Git and commits", "Display", "Optional features", "Connections"]);
    expect(navSections()[0]!.getAttribute("aria-current")).toBe("location");
    // The list sits right under the Project entry.
    const projectEntry = [...root.querySelectorAll(".settings-overlay-item")].find((b) => b.textContent?.includes("Project"))!;
    expect(projectEntry.nextElementSibling?.classList.contains("settings-overlay-sections")).toBe(true);
  });

  it("scrolls to a section and focuses its heading when it is chosen", async () => {
    stubApi();
    await mountInOverlay();
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };
    try {
      const git = navSections().find((b) => b.textContent === "Git and commits")!;
      await act(async () => { git.click(); });

      expect(scrolled).toEqual(["settings-section-git"]);
      expect(document.activeElement?.id).toBe("project-git-title");
      expect(git.getAttribute("aria-current")).toBe("location");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("keeps the highlight on a section jumped to at the end of the page", async () => {
    stubApi();
    await mountInOverlay();
    const content = root.querySelector<HTMLElement>(".settings-overlay-content")!;
    // Scrolled to the very bottom: the last section's rule would claim the highlight.
    Object.defineProperty(content, "scrollTop", { value: 500, configurable: true });
    Object.defineProperty(content, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(content, "clientHeight", { value: 500, configurable: true });
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const top = this === content ? 0 : this.id === "settings-section-optional" ? 120 : -200;
      return { top, bottom: this === content ? 500 : top + 10, left: 0, right: 0, width: 0, height: 10, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    try {
      const optional = navSections().find((b) => b.textContent === "Optional features")!;
      await act(async () => { optional.click(); });
      act(() => { content.dispatchEvent(new Event("scroll")); });
      expect(navSections().find((b) => b.getAttribute("aria-current") === "location")!.textContent).toBe("Optional features");
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      Element.prototype.scrollIntoView = originalScroll;
    }
  });

  it("moves the highlight as the content scrolls", async () => {
    stubApi();
    await mountInOverlay();
    const content = root.querySelector<HTMLElement>(".settings-overlay-content")!;
    Object.defineProperty(content, "scrollTop", { value: 300, configurable: true });
    // Sections from Display down have scrolled past the top of the content.
    const passed = new Set(["settings-section-analysis", "settings-section-dashboard", "settings-section-git", "settings-section-display"]);
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const top = passed.has(this.id) ? -50 : this === content ? 0 : 400;
      return { top, bottom: top + 10, left: 0, right: 0, width: 0, height: 10, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    // The overlay reads positions once a frame; run the frame at once.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    try {
      act(() => { content.dispatchEvent(new Event("scroll")); });
      expect(navSections().find((b) => b.getAttribute("aria-current") === "location")!.textContent).toBe("Display");
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it("lists only the sections a search leaves", async () => {
    stubApi();
    await mountInOverlay();
    const input = root.querySelector<HTMLInputElement>("#project-search")!;
    await act(async () => {
      input.value = "commit";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(navSections().map((b) => b.textContent)).toEqual(["Git and commits"]);
  });

  /**
   * A smooth jump from the top: scroll events arrive while the target heading
   * is still below the fold, then the scroll ends at the bottom of the page.
   * `place` moves the target heading; the content box is 0..500.
   */
  function stubLayout(content: HTMLElement) {
    const target = { top: 900 };
    Object.defineProperty(content, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(content, "clientHeight", { value: 500, configurable: true });
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const top = this === content ? 0 : this.id === "settings-section-optional" ? target.top : -200;
      return { top, bottom: this === content ? 500 : top + 10, left: 0, right: 0, width: 0, height: 10, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    const scrollTo = (scrollTop: number, headingTop: number) => {
      Object.defineProperty(content, "scrollTop", { value: scrollTop, configurable: true });
      target.top = headingTop;
      act(() => { content.dispatchEvent(new Event("scroll")); });
    };
    return {
      scrollTo,
      restore: () => {
        Element.prototype.getBoundingClientRect = originalRect;
        Element.prototype.scrollIntoView = originalScroll;
      },
    };
  }

  const current = () => navSections().find((b) => b.getAttribute("aria-current") === "location")!.textContent;

  it("keeps a smooth jump's target highlighted through the animation to the end of the page", async () => {
    stubApi();
    await mountInOverlay();
    const content = root.querySelector<HTMLElement>(".settings-overlay-content")!;
    const layout = stubLayout(content);
    try {
      await act(async () => { navSections().find((b) => b.textContent === "Optional features")!.click(); });
      // Mid-animation: the heading is still below the fold.
      layout.scrollTo(150, 750);
      expect(current()).toBe("Optional features");
      layout.scrollTo(300, 600);
      expect(current()).toBe("Optional features");
      // Arrived at the bottom, where the last section's rule would otherwise win.
      layout.scrollTo(500, 120);
      expect(current()).toBe("Optional features");
    } finally {
      layout.restore();
    }
  });

  it("lets the reader take over a jump by scrolling by hand", async () => {
    stubApi();
    await mountInOverlay();
    const content = root.querySelector<HTMLElement>(".settings-overlay-content")!;
    const layout = stubLayout(content);
    try {
      await act(async () => { navSections().find((b) => b.textContent === "Optional features")!.click(); });
      layout.scrollTo(150, 750);
      act(() => { content.dispatchEvent(new Event("wheel")); });
      layout.scrollTo(500, 120);
      expect(current()).toBe("Connections");
    } finally {
      layout.restore();
    }
  });

  it("drops Project's sections when the overlay moves to another page", async () => {
    stubApi();
    await mountInOverlay();
    expect(navSections()).toHaveLength(6);

    const views = new Set<ViewId>(["robot-wrangler", "project", "workflow", "commands"]);
    act(() => {
      render(h(SettingsOverlay, { view: "workflow", validViews: views, onNavigate: () => {}, onClose: () => {} },
        h("div", null, "workflow page")), root);
    });
    await settle();
    expect(navSections()).toEqual([]);
  });
});
