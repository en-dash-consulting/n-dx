// @vitest-environment jsdom
/**
 * The hub page's in-card Initialize, executed.
 *
 * Runs the page's refresh and init scripts against rendered markup with
 * `fetch` stubbed as the project server's init routes, so the loading, success
 * and failure states are checked as the browser would reach them — including
 * that no way out leaves the card locked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHomePage, renderCards, HUB_INIT_CLIENT_TIMEOUT_MS } from "../../../src/hub/home.js";
import type { HubOverview, ProjectCard } from "../../../src/hub/overview.js";

function card(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: "gamma", name: "Gamma", repoRoot: "/repos/gamma", url: "/p/gamma/",
    state: "healthy", port: 4003, reachable: true, error: null,
    branch: "main", dirtyFiles: 0, activeRuns: 0, percentComplete: null, nextTaskTitle: null,
    analyzedAt: null, repoName: null, remoteHost: null, readiness: null, infrastructure: null,
    initialized: false,
    ...overrides,
  };
}

const overview = (c: ProjectCard): HubOverview => ({ generatedAt: "t", projects: [c] });

interface InitStatus { running: boolean; finishedAt: string | null; output: string; error: string | null }

let startResponse: { status: number; body: Record<string, unknown> };
let statuses: InitStatus[];
let posted: Array<{ url: string; body: unknown }>;
let overviewCard: ProjectCard;

function mountPage(): void {
  const html = renderHomePage(overview(card()));
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  const scripts = [...parsed.querySelectorAll("script")].map((s) => s.textContent ?? "");
  window.eval(scripts.find((t) => t.includes("/api/hub/overview"))!);
  window.eval(scripts.find((t) => t.includes('data-action="init"'))!);
}

const cardEl = () => document.querySelector(".card") as HTMLElement;
const button = () => cardEl().querySelector(".actions button") as HTMLButtonElement | null;
const overlay = () => cardEl().querySelector(".init-overlay") as HTMLElement | null;
const errorLine = () => cardEl().querySelector(".init-error") as HTMLElement | null;

describe("Initialize on an uninitialized card, running", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startResponse = { status: 202, body: { ok: true } };
    statuses = [];
    posted = [];
    overviewCard = card();
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      if (url === "/api/hub/overview") {
        const ov = overview(overviewCard);
        return { ok: true, json: async () => ({ ...ov, html: renderCards(ov) }) } as unknown as Response;
      }
      if (url === "/p/gamma/api/commands/init" && opts?.method === "POST") {
        posted.push({ url, body: JSON.parse(opts.body ?? "{}") });
        return { status: startResponse.status, json: async () => startResponse.body } as unknown as Response;
      }
      if (url === "/p/gamma/api/commands/init/status") {
        const next = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
        return { ok: true, status: 200, json: async () => next } as unknown as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("locks the card under an overlay showing the current step while init runs", async () => {
    statuses = [{ running: true, finishedAt: null, output: "\u001b[32mAnalyzing codebase…\u001b[0m\n", error: null }];
    mountPage();
    button()!.click();

    // Locked synchronously: there is never a moment the button looks idle.
    expect(overlay()!.hidden).toBe(false);
    expect(button()!.disabled).toBe(true);
    expect(cardEl().getAttribute("aria-busy")).toBe("true");

    await vi.advanceTimersByTimeAsync(1600);
    // The wizard's own route, with the wizard's defaults.
    expect(posted).toEqual([{ url: "/p/gamma/api/commands/init", body: { provider: "claude" } }]);
    expect(cardEl().querySelector(".init-phase")!.textContent).toMatch(/^Analyzing codebase… \(\d+s\)$/);

    // A second click while locked starts nothing.
    button()!.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(posted).toHaveLength(1);

    // The refresh tick leaves the running card alone.
    await vi.advanceTimersByTimeAsync(5000);
    expect(overlay()!.hidden).toBe(false);
  });

  it("swaps to the initialized card's actions on success, without a reload", async () => {
    statuses = [
      { running: true, finishedAt: null, output: "", error: null },
      { running: false, finishedAt: "2026-11-04T00:00:00.000Z", output: "done", error: null },
    ];
    mountPage();
    button()!.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(overlay()!.hidden).toBe(false);

    overviewCard = card({ initialized: true });
    await vi.advanceTimersByTimeAsync(1600);

    expect(cardEl().classList.contains("card-uninitialized")).toBe(false);
    expect(cardEl().textContent).toContain("Start working");
    expect(cardEl().textContent).toContain("Open dashboard");
    expect(cardEl().querySelector(".init-overlay")).toBeNull();
  });

  it("unlocks with the error and a Retry when the run fails, and survives a refresh", async () => {
    statuses = [{ running: false, finishedAt: "2026-11-04T00:00:00.000Z", output: "", error: "claude CLI not found" }];
    mountPage();
    button()!.click();
    await vi.advanceTimersByTimeAsync(1600);

    expect(overlay()!.hidden).toBe(true);
    expect(errorLine()!.hidden).toBe(false);
    expect(errorLine()!.textContent).toBe("claude CLI not found");
    expect(button()!.textContent).toBe("Retry");
    expect(button()!.disabled).toBe(false);
    expect(cardEl().hasAttribute("aria-busy")).toBe(false);

    button()!.blur();
    await vi.advanceTimersByTimeAsync(5000);
    expect(errorLine()!.textContent).toBe("claude CLI not found");

    // Retry runs init again.
    statuses = [{ running: true, finishedAt: null, output: "", error: null }];
    button()!.click();
    expect(overlay()!.hidden).toBe(false);
    expect(errorLine()!.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(posted).toHaveLength(2);
  });

  it("shows a refused start as an error rather than locking", async () => {
    startResponse = { status: 400, body: { error: "provider must be one of: claude" } };
    mountPage();
    button()!.click();
    await vi.advanceTimersByTimeAsync(10);

    expect(overlay()!.hidden).toBe(true);
    expect(errorLine()!.textContent).toBe("provider must be one of: claude");
    expect(button()!.disabled).toBe(false);
  });

  it("gives up and unlocks when the run never finishes", async () => {
    statuses = [{ running: true, finishedAt: null, output: "", error: null }];
    mountPage();
    button()!.click();
    await vi.advanceTimersByTimeAsync(HUB_INIT_CLIENT_TIMEOUT_MS + 3000);

    expect(overlay()!.hidden).toBe(true);
    expect(errorLine()!.textContent).toContain("did not finish in time");
    expect(button()!.disabled).toBe(false);
  });
});
