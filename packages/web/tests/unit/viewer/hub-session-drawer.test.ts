// @vitest-environment jsdom
/**
 * The hub session drawer (story 25, part 3): the drawer-only viewer entry the
 * hub home docks. Its head carries the purple "Hub · all projects" scope chip,
 * the snapshot's Δ count and the Hub lens chip; the composer says
 * "read-only · drafts" and meters the context against the hub ceiling.
 * Every read goes through the hub at /hub/session/.
 *
 * The harness renders the entry's own `HubSessionApp` against a stubbed hub
 * and socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { mountHubSession, openWorktreeDashboard, requestClose } from "../../../src/viewer/hub-session.js";
import { HUB_SESSION_PAGE_CONFIG_ID, hubSessionPageConfig } from "../../../src/server/routes-sidecar.js";
import { HUB_SESSION_CLOSE_MESSAGE } from "../../../src/shared/index.js";
import { formatTokens, snapshotChipLabel } from "../../../src/viewer/components/hub-session-drawer.js";
import type { HubSnapshotWorktree } from "../../../src/viewer/hooks/use-hub-session.js";
import { handedOffSessionParam, latestContextTokens, type SidecarFrame, type SidecarSessionEntry } from "../../../src/viewer/hooks/use-sidecar.js";

interface Hub {
  lensAvailable: boolean;
  ceiling: number;
  /** GET /hub/session/snapshot's Δ count; null answers as with no open session. */
  changed: number | null;
  sessions: SidecarSessionEntry[];
  frames: SidecarFrame[];
  requests: Array<{ method: string; url: string; body?: unknown }>;
  /** The snapshot's worktrees; absent answers as before a delivered turn. */
  worktrees?: HubSnapshotWorktree[];
  /** What POST /hub/session/handoff refuses with. */
  handoffRefusal?: string;
}

let hub: Hub;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function hubSession(): SidecarSessionEntry {
  return {
    session: {
      id: "h1", name: "Hub session", vendor: "claude", lens: "hub", cursor: 0, turns: 1,
      createdAt: "2026-11-02T10:00:00.000Z", lastActivityAt: "2026-11-02T10:00:00.000Z",
    },
    running: false,
  } as SidecarSessionEntry;
}

function stubHub(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    hub.requests.push({ method, url, ...(body !== undefined && { body }) });
    if (url === "/hub/session/lens") {
      return json({
        lens: { id: "hub", available: hub.lensAvailable, ...(!hub.lensAvailable && { needs: "web.sidecar turned on in the project hosting the hub session" }) },
        ceiling: hub.ceiling,
      });
    }
    if (url === "/hub/session/snapshot") {
      const open = hub.sessions[0]?.session.id ?? null;
      return json({ session: open, changed: open ? hub.changed : null, ...(open && hub.worktrees && { worktrees: hub.worktrees }) });
    }
    if (url === "/hub/session/handoff" && method === "POST") return json({ error: hub.handoffRefusal }, 502);
    if (url === "/hub/session/sessions" && method === "GET") return json({ sessions: hub.sessions });
    if (url === "/hub/session/sessions" && method === "POST") {
      const created = hubSession();
      hub.sessions.push(created);
      return json(created, 201);
    }
    const m = /^\/hub\/session\/sessions\/([\w-]+)\/(frames|cards|turns)(?:\?after=(\d+))?$/.exec(url);
    if (m) {
      const [, , action, after] = m;
      if (action === "frames") {
        const frames = hub.frames.filter((f) => f.seq > Number(after));
        return json({ frames, cursor: frames.at(-1)?.seq ?? Number(after), running: false });
      }
      if (action === "cards") return json({ cards: [] });
      if (action === "turns") return json({ session: hubSession().session, running: true, from: 0 }, 202);
    }
    return json({ error: `unexpected ${method} ${url}` }, 404);
  }));
}

class FakeSocket {
  static urls: string[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string) { FakeSocket.urls.push(url); }
  close() {}
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

let root: HTMLDivElement;
let configBlock: HTMLScriptElement | null = null;

/** The page as the host serves it: the config block the drawer route injects, then the app root. */
async function mount({ served = true } = {}): Promise<void> {
  if (served) {
    configBlock = document.createElement("script");
    configBlock.type = "application/json";
    configBlock.id = HUB_SESSION_PAGE_CONFIG_ID;
    configBlock.textContent = JSON.stringify(hubSessionPageConfig());
    document.body.appendChild(configBlock);
  }
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { mountHubSession(root); });
  await settle();
}

const chips = () => [...root.querySelectorAll(".hub-session-chips .sidecar-chip")];

beforeEach(() => {
  hub = { lensAvailable: true, ceiling: 40_000, changed: 3, sessions: [], frames: [], requests: [] };
  FakeSocket.urls = [];
  stubHub();
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(async () => {
  await act(async () => { render(null, root); });
  root.remove();
  configBlock?.remove();
  configBlock = null;
  vi.unstubAllGlobals();
});

describe("the hub session drawer", () => {
  it("heads itself Hub session with the purple hub scope chip, the snapshot's Δ and the Hub lens", async () => {
    hub.sessions = [hubSession()];
    await mount();

    expect(root.querySelector(".sidecar-head .sidecar-title")?.textContent).toBe("Hub session");
    const [scope, snapshot, lens] = chips();
    expect(scope.classList.contains("sidecar-chip-scope-hub")).toBe(true);
    expect(scope.textContent).toBe("Hub · all projects");
    expect(snapshot.textContent).toBe("snapshot · 3 Δ since your last turn");
    expect(lens.classList.contains("sidecar-chip-lens")).toBe(true);
    expect(lens.textContent).toBe("Hub");
    // There is nothing to pick: Claude on the hub lens, for good.
    expect(root.querySelector(".sidecar-vendor, .sidecar-model, .sidecar-lens-menu, .sidecar-sessions-toggle")).toBeNull();
  });

  it("says the session reads and drafts, and meters the context the next turn resumes with against the 40k ceiling", async () => {
    hub.sessions = [hubSession()];
    hub.frames = [
      { seq: 1, at: "t", type: "user", text: "what is open?" },
      { seq: 2, at: "t", type: "event", event: { type: "token_usage", tokenUsage: { input: 9_000, output: 40, cacheReadInput: 3_000 } } },
      { seq: 3, at: "t", type: "event", event: { type: "assistant", text: "two PRs" } },
    ];
    await mount();

    const composer = root.querySelector(".sidecar-composer")!;
    expect(composer.querySelector(".hub-session-mode")?.textContent).toBe("read-only · drafts");
    const meter = composer.querySelector("[role=meter]")!;
    expect(meter.getAttribute("aria-valuemax")).toBe("40000");
    expect(meter.getAttribute("aria-valuenow")).toBe("12000");
    expect(meter.textContent).toBe("12k / 40k");
  });

  it("reaches the session only through the hub, Claude on the hub lens, over the hub's socket", async () => {
    await mount();
    const input = root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
    await act(async () => {
      input.value = "what changed?";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { root.querySelector<HTMLFormElement>(".sidecar-composer")!.requestSubmit(); });
    await settle();

    const create = hub.requests.find((r) => r.method === "POST" && r.url === "/hub/session/sessions");
    expect(create?.body).toEqual({ vendor: "claude", lens: "hub" });
    expect(hub.requests.some((r) => r.method === "POST" && r.url === "/hub/session/sessions/h1/turns")).toBe(true);
    // Nothing the page reads is a project's own route.
    expect(hub.requests.filter((r) => !r.url.startsWith("/hub/session/"))).toEqual([]);
    expect(FakeSocket.urls).toEqual([`ws://${location.host}/hub/session`]);
  });

  it("says where the drawer lives, and reads nothing, on a page no host served", async () => {
    await mount({ served: false });
    expect(root.querySelector("[role=alert]")?.textContent).toContain("/hub/session/drawer");
    expect(root.querySelector(".hub-session-drawer")).toBeNull();
    expect(hub.requests).toEqual([]);
  });

  it("names the lens not available while the host cannot run it", async () => {
    hub.lensAvailable = false;
    await mount();
    expect(chips()[2].textContent).toBe("Hubnot available");
    expect(chips()[2].getAttribute("title")).toContain("web.sidecar");
  });
});

describe("Open in worktree sidecar", () => {
  const worktrees: HubSnapshotWorktree[] = [
    { project: "app", projectName: "app", key: "feat", branch: "feat/sidecar-api", changed: true },
    { project: "app", projectName: "app", key: "main", branch: "main", changed: false },
  ];

  it("lists the snapshot's worktrees, Δ on a changed one, each with Open in worktree sidecar", async () => {
    hub.sessions = [hubSession()];
    hub.worktrees = worktrees;
    await mount();
    const rows = [...root.querySelectorAll(".hub-worktree")];
    expect(root.querySelector(".hub-worktrees-summary")?.textContent).toBe("Worktrees · 2");
    expect(rows.map((r) => r.querySelector(".hub-worktree-name")?.textContent)).toEqual(["Δ app · feat/sidecar-api", "app · main"]);
    expect(rows[0]!.querySelector("button")?.getAttribute("aria-label")).toBe("Open in worktree sidecar: app · feat/sidecar-api");
  });

  it("posts the worktree to the hub's handoff route and shows why it was refused", async () => {
    hub.sessions = [hubSession()];
    hub.worktrees = worktrees;
    hub.handoffRefusal = "The worktree's server refused the handoff: HTTP 403";
    await mount();
    await act(async () => { root.querySelector<HTMLButtonElement>(".hub-worktree-open")!.click(); });
    await settle();
    expect(hub.requests.find((r) => r.url === "/hub/session/handoff")).toEqual({
      method: "POST", url: "/hub/session/handoff", body: { project: "app", worktree: "feat" },
    });
    expect(root.querySelector(".hub-worktrees [role=alert]")?.textContent).toBe("The worktree's server refused the handoff: HTTP 403");
  });

  it("lists nothing before a turn has read the snapshot", async () => {
    hub.sessions = [hubSession()];
    await mount();
    expect(root.querySelector(".hub-worktrees")).toBeNull();
  });

  it("sends the framing hub home, or the page itself when unframed, to the worktree's dashboard", () => {
    const went: string[] = [];
    const parent = { location: { assign: (url: string) => went.push(`parent ${url}`) } };
    openWorktreeDashboard("/p/app/w/feat/?sidecar=s-1", { parent } as unknown as Window);
    const alone = { location: { assign: (url: string) => went.push(`self ${url}`) } } as unknown as Window & { parent: Window };
    alone.parent = alone;
    openWorktreeDashboard("/p/app/?sidecar=s-2", alone);
    expect(went).toEqual(["parent /p/app/w/feat/?sidecar=s-1", "self /p/app/?sidecar=s-2"]);
  });

  it("reads the session a worktree dashboard opens its drawer on from ?sidecar=", () => {
    expect(handedOffSessionParam("?sidecar=0b2c-44")).toBe("0b2c-44");
    expect(handedOffSessionParam("?view=prd")).toBeNull();
    expect(handedOffSessionParam("?sidecar=../x")).toBeNull();
  });
});

describe("closing", () => {
  it("asks the framing hub home to undock it, on the home's origin, and does nothing when not framed", () => {
    const posted: Array<{ data: unknown; origin: string }> = [];
    const parent = { postMessage: (data: unknown, origin: string) => posted.push({ data, origin }) };
    const framed = { parent, location: { origin: "http://127.0.0.1:3117" } } as unknown as Window;
    const { closeMessage } = hubSessionPageConfig();
    requestClose(closeMessage, framed);
    // The type the hub home's script listens for.
    expect(posted).toEqual([{ data: { type: HUB_SESSION_CLOSE_MESSAGE }, origin: "http://127.0.0.1:3117" }]);

    const alone = { location: { origin: "http://x" } } as unknown as Window & { parent: Window };
    alone.parent = alone;
    requestClose(closeMessage, alone);
    expect(posted).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("formats token counts the way the meter shows them", () => {
    expect(formatTokens(40_000)).toBe("40k");
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(1_234)).toBe("1.2k");
    expect(formatTokens(2_000)).toBe("2k");
    expect(formatTokens(950)).toBe("950");
  });

  it("labels the snapshot chip by what the host answered", () => {
    expect(snapshotChipLabel(null)).toBe("snapshot · reading…");
    expect(snapshotChipLabel({ session: "h1", changed: 0 })).toBe("snapshot · 0 Δ since your last turn");
    expect(snapshotChipLabel({ session: null, changed: null })).toBe("snapshot · read on your first turn");
    expect(snapshotChipLabel({ session: "h1", changed: null, error: "no hub is running" })).toBe("snapshot · unavailable");
  });

  it("measures the context from the last call's tokens, back to zero after a refresh, ignoring the checkpoint's own calls", () => {
    const usage = (seq: number, input: number, checkpoint = false): SidecarFrame => ({
      seq, at: "t", type: "event", event: { type: "token_usage", tokenUsage: { input, output: 1, cacheCreationInput: 10 } },
      ...(checkpoint && { checkpoint: true as const }),
    });
    expect(latestContextTokens([])).toBe(0);
    expect(latestContextTokens([usage(1, 100), usage(2, 500)])).toBe(510);
    expect(latestContextTokens([usage(1, 500), usage(2, 9_999, true)])).toBe(510);
    expect(latestContextTokens([usage(1, 500), { seq: 2, at: "t", type: "context-refreshed", notes: 3, contextTokens: 500 }])).toBe(0);
  });
});
