// @vitest-environment jsdom
/**
 * The Sidecar drawer (story 07, part 1): the top-nav button and ⌘J behind
 * `web.sidecar`, the drawer docked beside the page, the transcript tailed by
 * cursor, the composer, and the waiting-card badge.
 *
 * The harness renders what main.ts renders for Sidecar — `web.sidecar` read
 * through `useFeatureToggle` into `useSidecarShell`, then `TopNav` and
 * `SidecarDock` — against a stubbed server and socket.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TopNav } from "../../../src/viewer/components/top-nav.js";
import { SidecarDock, SidecarFrameRow, clampSidecarWidth, effectiveSidecarWidth, pairToolResults, summarizeToolInput } from "../../../src/viewer/components/sidecar-drawer.js";
import {
  isSidecarShortcut,
  mergeFrames,
  pickOpenSession,
  useSidecarShell,
  type SidecarCard,
  type SidecarCardKind,
  type SidecarFrame,
  type SidecarSessionEntry,
} from "../../../src/viewer/hooks/use-sidecar.js";
import {
  pageItemFor,
  resolveLens,
  wantedLensFor,
  type SidecarLensInfo,
  type SidecarPageSelection,
} from "../../../src/viewer/hooks/use-sidecar-attachment.js";
import { SidecarCards } from "../../../src/viewer/components/sidecar-cards.js";
import { openExtensionTab } from "../../../src/viewer/components/sidecar-extension-tabs.js";
import { installBasePathFetch, setBasePathForTests } from "../../../src/viewer/base-path.js";
import { SettingsOverlay } from "../../../src/viewer/components/settings-overlay.js";
import { useFeatureToggle } from "../../../src/viewer/hooks/use-feature-toggle.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { ViewId } from "../../../src/viewer/types.js";

/** `text` with every regular-expression metacharacter escaped, for building a pattern from a CSS selector. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const VALID = buildValidViews(null);

// ── Stub server ────────────────────────────────────────────────────────────

interface Server {
  enabled: boolean;
  /** What the frames route says about the open session's turn. */
  running: boolean;
  /** While set, a frames read waits on it — a read the server took but has not answered. */
  gate: Promise<void> | null;
  sessions: SidecarSessionEntry[];
  frames: SidecarFrame[];
  cards: SidecarCard[];
  /** While set, each cards read snapshots its answer and waits here until released. */
  heldCardReads: Array<() => void> | null;
  /** GET /api/commands/manifest's command effects, by name. */
  manifest: Record<string, unknown>;
  /** Whether each vendor's CLI is installed, per GET /api/llm/catalog; unset vendors report nothing. */
  catalogCli: Record<string, boolean>;
  requests: Array<{ method: string; url: string; body?: unknown }>;
  /** GET /api/workspaces; the anchor is "main". */
  workspaces: Array<{ key: string; branch: string | null }>;
  /** Sessions the other worktrees hold, by workspace key, read through /w/<key>/api/sidecar/sessions. */
  otherSessions: Record<string, SidecarSessionEntry[]>;
  /** GET /api/sidecar/lenses: the M1 registry. */
  lenses: SidecarLensInfo[];
  /** While set, a lenses read waits on it — the registry has not answered yet. */
  lensesGate?: Promise<void>;
  /** Status of the newest hench run of any task, per GET /api/hench/runs?taskId=; unset means no runs. */
  lastRunStatus?: string;
  /** Drawer tabs the hub lists for project p1; unset means no hub answers. */
  hubTabs?: Array<{ name: string; label: string }>;
  /** The keyed page's answer; unset is a 200. A pending promise is a sidecar still starting. */
  pageAnswer?: () => Response | Promise<Response>;
  /** While set, PATCH /api/sidecar/sessions/:id answers 500 with this error. */
  patchError?: string;
  /** While set, POST /api/sidecar/sessions answers 500 with this error. */
  createError?: string;
}

/** A card as the server sends it; `n` orders its raisedAt. */
function card(id: string, n: number, over: Partial<SidecarCard> = {}): SidecarCard {
  return {
    id, sessionId: "s1", tool: "run_command", kind: "command", input: { argv: ["ndx", "status", "."] },
    allowListKey: null, status: "pending", raisedAt: `2026-10-28T10:00:0${n}.000Z`, ...over,
  };
}

let server: Server;

function session(over: Partial<SidecarSessionEntry["session"]> = {}): SidecarSessionEntry["session"] {
  return {
    id: "s1", name: "Ask about zones", vendor: "claude", cursor: 0, turns: 0,
    createdAt: "2026-10-28T10:00:00.000Z", lastActivityAt: "2026-10-28T10:00:00.000Z", ...over,
  };
}

const user = (seq: number, text: string): SidecarFrame => ({ seq, at: "t", type: "user", text });
const said = (seq: number, text: string): SidecarFrame => ({
  seq, at: "t", type: "event", event: { type: "assistant", text },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The catalog's `cli` probe for `vendor`; absent unless the test set it. */
function cliProbe(vendor: string): { cli?: { found: boolean; version: null; path: null } } {
  const found = server.catalogCli[vendor];
  return found === undefined ? {} : { cli: { found, version: null, path: null } };
}

function stubServer(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    // The tab's page probe is absolute (it must skip the base-path rewrite).
    const url = String(input).replace(location.origin, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    server.requests.push({ method, url, ...(body !== undefined && { body }) });
    if (url === "/api/features") {
      return json({ toggles: [{ key: "web.sidecar", enabled: server.enabled }] });
    }
    if (url === "/api/project") return json({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory", cliName: "n-dx" });
    if (url === "/api/llm/config") return json({ vendor: "codex" });
    if (url === "/api/llm/catalog" || url === "/api/llm/catalog?refresh=true") {
      return json({
        claude: { models: ["claude-sonnet-5-5", "claude-haiku-4-5"], defaultModel: "claude-sonnet-5-5", ...cliProbe("claude") },
        codex: { models: ["gpt-5.5", "gpt-5.5-mini"], defaultModel: "gpt-5.5", ...cliProbe("codex") },
        google: { models: ["gemini-x"], defaultModel: "gemini-x" },
        local: { models: [], defaultModel: "" },
      });
    }
    if (url === "/api/sidecar/settings" && method === "PUT") return json({ githubReads: body.githubReads });
    if (url === "/api/sidecar/lenses") {
      if (server.lensesGate) await server.lensesGate;
      return json({ lenses: server.lenses });
    }
    if (url.startsWith("/api/hench/runs?")) {
      // The shape routes-hench.ts answers with.
      return json({ runs: server.lastRunStatus ? [{ id: "r1", status: server.lastRunStatus }] : [], total: 0 });
    }
    if (url === "/api/workspaces") {
      return json({ anchor: "main", workspaces: server.workspaces.map((w) => ({ ...w, path: "/x", isAnchor: w.key === "main", active: true })) });
    }
    const other = /^\/w\/([\w-]+)\/api\/sidecar\/sessions(?:\/([\w-]+)\/cards)?$/.exec(url);
    if (other) return json(other[2] ? { cards: [] } : { sessions: server.otherSessions[other[1]] ?? [] });
    const own = /^\/api\/sidecar\/sessions\/([\w-]+)(\/end)?$/.exec(url);
    if (own && (method === "PATCH" || own[2])) {
      if (method === "PATCH" && server.patchError) return json({ error: server.patchError }, 500);
      const entry = server.sessions.find((e) => e.session.id === own[1])!;
      if (own[2]) entry.session.endedAt = "2026-10-28T12:00:00.000Z";
      else Object.assign(entry.session, body);
      return json(entry);
    }
    if (url === "/api/sidecar/sessions" && method === "GET") return json({ sessions: server.sessions });
    if (url === "/api/sidecar/sessions" && method === "POST") {
      if (server.createError) return json({ error: server.createError }, 500);
      const created = { session: session({ id: "new", vendor: body.vendor, model: body.model }), running: false };
      server.sessions.push(created);
      return json(created, 201);
    }
    if (url === "/api/commands/manifest") {
      return json({
        cliName: "ndx",
        layoutPaths: { rex: ".rex", prdRead: ".rex/product/ and .rex/changes/" },
        groups: [{ id: "g", label: "G", commands: Object.entries(server.manifest).map(([name, effects]) => ({ name, effects })) }],
      });
    }
    const m = /^\/api\/sidecar\/sessions\/([\w-]+)\/(frames|cards|turns|interrupt)(?:\/([\w-]+))?(?:\?after=(\d+))?$/.exec(url);
    if (m) {
      const [, id, action, cardId, after] = m;
      if (action === "cards" && cardId) {
        const decided = server.cards.find((c) => c.id === cardId)!;
        decided.status = body.decision === "approve" ? "approved" : "denied";
        return json({ card: decided });
      }
      if (action === "cards" && server.heldCardReads) {
        const answer = json({ cards: server.cards.filter((c) => c.sessionId === id).map((c) => ({ ...c })) });
        await new Promise<void>((r) => server.heldCardReads!.push(r));
        return answer;
      }
      if (action === "frames") {
        const running = server.running;
        if (server.gate) await server.gate;
        const frames = server.frames.filter((f) => f.seq > Number(after));
        return json({ frames, cursor: frames.at(-1)?.seq ?? Number(after), running });
      }
      if (action === "cards") return json({ cards: server.cards.filter((c) => c.sessionId === id) });
      if (action === "turns") {
        server.running = true;
        return json({ session: session({ id }), running: true, from: 0 }, 202);
      }
      if (action === "interrupt") return json({ interrupted: true });
    }
    if (server.hubTabs) {
      if (url === "/api/hub/projects") return json({ projects: [{ id: "p1", name: "P1", status: { state: "running" } }] });
      if (url === "/api/hub/extensions?project=p1") {
        return json({ extensions: server.hubTabs.map((t) => ({ name: t.name, tab: { label: t.label, url: `/x/${t.name}/tab` } })) });
      }
      const frame = /^\/api\/hub\/extensions\/([\w-]+)\/frame\?project=p1$/.exec(url);
      if (frame && method === "POST") return json({ url: `/x/${frame[1]}/~f/key${server.requests.length}/tab?project=p1` });
      if (url.startsWith("/x/")) return server.pageAnswer ? await server.pageAnswer() : new Response("<p>tab</p>");
    }
    return json({});
  }));
}

// ── Stub socket ────────────────────────────────────────────────────────────

/** Every component that listens opens its own socket; a frame reaches them all. */
class FakeSocket {
  static open = new Set<FakeSocket>();
  onmessage: ((e: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() { FakeSocket.open.add(this); }
  close() { FakeSocket.open.delete(this); }
}

async function announce(message: Record<string, unknown>): Promise<void> {
  await act(async () => {
    for (const socket of FakeSocket.open) socket.onmessage?.({ data: JSON.stringify(message) });
  });
  // The pipeline coalesces for 100 ms before it flushes.
  await act(async () => { await new Promise<void>((r) => setTimeout(r, 150)); });
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

// ── Harness: what main.ts renders for Sidecar ─────────────────────────────

/** The hook state the last render of Shell saw, for tests that call its methods as main.ts does. */
let lastSidecar: ReturnType<typeof useSidecarShell>["sidecar"] | null = null;

function Shell({ view, page }: { view: ViewId; page?: Partial<SidecarPageSelection> }) {
  const shell = useSidecarShell(useFeatureToggle("web.sidecar", false), { view, zone: null, taskId: null, ...page });
  lastSidecar = shell.sidecar;
  return h("div", null,
    h(TopNav, { view, validViews: VALID, onNavigate: vi.fn(), onOpenSearch: vi.fn(), sidecar: shell.button }),
    h(SidecarDock, { open: shell.drawer.open, sidecar: shell.sidecar, onClose: shell.drawer.close },
      h("div", { class: "app-body" }, h("main", { id: "main-content" }, "page")),
    ),
  );
}

let root: HTMLDivElement;

async function mount(view: ViewId = "analyze", page?: Partial<SidecarPageSelection>): Promise<void> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(h(Shell, { view, page }), root); });
  await settle();
}

async function unmount(): Promise<void> {
  await act(async () => { render(null, root); });
  root.remove();
}

async function pressCmdJ(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true }));
  });
  await settle();
}

const button = () => root.querySelector<HTMLButtonElement>(".topnav-sidecar");
const drawer = () => root.querySelector(".sidecar-drawer");
const rows = () => [...root.querySelectorAll(".sidecar-transcript [data-seq]")].map((el) => el.textContent);
const frameFetches = () => server.requests.filter((r) => r.url.includes("/frames")).map((r) => r.url);

beforeEach(() => {
  clearProjectMetadataCache();
  localStorage.clear();
  server = {
    enabled: true, running: false, gate: null, sessions: [], frames: [], cards: [],
    heldCardReads: null, manifest: {}, catalogCli: {}, requests: [],
    workspaces: [{ key: "main", branch: "main" }, { key: "feat", branch: "feat/other" }], otherSessions: {},
    lenses: [
      { id: "general", available: true },
      { id: "explain", available: true },
      { id: "describe", available: true },
      { id: "plan", available: true },
      { id: "guide", available: false, needs: "the queue planner" },
      { id: "diagnose-run", available: false, needs: "the run classifier" },
    ],
  };
  FakeSocket.open.clear();
  stubServer();
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(async () => {
  if (root?.isConnected) await unmount();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--sidecar-w");
});

// ── Pure helpers ───────────────────────────────────────────────────────────

describe("helpers", () => {
  it("merges frames by seq, never twice", () => {
    const merged = mergeFrames([user(1, "a"), said(2, "b")], [said(2, "b"), user(3, "c")]);
    expect(merged.map((f) => f.seq)).toEqual([1, 2, 3]);
  });

  it("opens the most recently active session that has not ended", () => {
    const entries = [
      { session: session({ id: "old", lastActivityAt: "2026-10-28T09:00:00.000Z" }), running: false },
      { session: session({ id: "ended", lastActivityAt: "2026-10-28T12:00:00.000Z", endedAt: "x" }), running: false },
      { session: session({ id: "recent", lastActivityAt: "2026-10-28T11:00:00.000Z" }), running: false },
    ];
    expect(pickOpenSession(entries)?.session.id).toBe("recent");
    expect(pickOpenSession([])).toBeNull();
  });

  it("reads ⌘J and Ctrl+J as the toggle, nothing else", () => {
    const key = (over: Partial<KeyboardEvent>) => ({ key: "j", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
    expect(isSidecarShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSidecarShortcut(key({ ctrlKey: true, key: "J" }))).toBe(true);
    expect(isSidecarShortcut(key({}))).toBe(false);
    expect(isSidecarShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSidecarShortcut(key({ metaKey: true, key: "k" }))).toBe(false);
  });

  it("clamps the width to 360–640", () => {
    expect(clampSidecarWidth(200)).toBe(360);
    expect(clampSidecarWidth(900)).toBe(640);
    expect(clampSidecarWidth(500)).toBe(500);
    expect(clampSidecarWidth(Number.NaN)).toBe(440);
  });
});

// ── Button, toggle, route ─────────────────────────────────────────────────

describe("the top-nav button", () => {
  it("ends the top nav behind a divider, with ⌘J in its tooltip", async () => {
    await mount();
    const nav = root.querySelector(".topnav")!;
    const last = nav.lastElementChild!;
    expect(last.classList.contains("topnav-sidecar")).toBe(true);
    expect(last.previousElementSibling?.classList.contains("topnav-divider")).toBe(true);
    expect(last.getAttribute("title")).toContain("⌘J");
  });

  it("does not render, and ⌘J does nothing, with web.sidecar off", async () => {
    server.enabled = false;
    await mount();
    expect(server.requests.some((r) => r.url === "/api/features")).toBe(true);
    expect(button()).toBeNull();
    await pressCmdJ();
    expect(drawer()).toBeNull();
    expect(server.requests.some((r) => r.url.startsWith("/api/sidecar"))).toBe(false);
  });

  it.each(["analyze", "plan", "work", "live"] as ViewId[])("⌘J toggles the drawer on %s", async (view) => {
    await mount(view);
    await pressCmdJ();
    expect(drawer()).not.toBeNull();
    expect(button()?.getAttribute("aria-expanded")).toBe("true");
    await pressCmdJ();
    expect(drawer()).toBeNull();
  });

  it("opening the drawer adds no view and leaves the route alone", async () => {
    expect([...VALID].some((v) => String(v).includes("sidecar"))).toBe(false);
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const before = location.href;
    await mount();
    await act(async () => { button()!.click(); });
    await settle();
    expect(drawer()).not.toBeNull();
    expect(location.href).toBe(before);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    push.mockRestore();
    replace.mockRestore();
  });

  it("docks the drawer beside the page body at 440 px and tells the status dock its width", async () => {
    await mount();
    await pressCmdJ();
    const dock = root.querySelector(".app-dock")!;
    expect(dock.firstElementChild?.classList.contains("app-body")).toBe(true);
    expect(dock.lastElementChild).toBe(drawer());
    expect((drawer() as HTMLElement).style.width).toBe("440px");
    expect(document.documentElement.style.getPropertyValue("--sidecar-w")).toBe("440px");
  });

  it("resizes from its edge by keyboard within 360–640 and remembers the width", async () => {
    await mount();
    await pressCmdJ();
    const edge = root.querySelector<HTMLElement>(".sidecar-resize")!;
    await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    expect((drawer() as HTMLElement).style.width).toBe("640px");
    await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect((drawer() as HTMLElement).style.width).toBe("640px");
    await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
    expect((drawer() as HTMLElement).style.width).toBe("360px");
    expect(localStorage.getItem("ndx-sidecar-width")).toBe("360");
  });
});

describe("wide mode", () => {
  const original = window.innerWidth;
  const setViewport = (w: number) => { (window as { innerWidth: number }).innerWidth = w; };
  const toggle = () => root.querySelector<HTMLButtonElement>(".sidecar-wide-toggle");
  afterEach(() => { setViewport(original); vi.restoreAllMocks(); });

  it("computes the width: wide takes most of the viewport and leaves the page 480 px", () => {
    expect(effectiveSidecarWidth(440, false, 1440)).toBe(440);
    expect(effectiveSidecarWidth(440, true, 1440)).toBe(960);
    expect(effectiveSidecarWidth(440, true, 1920)).toBe(1344);
    expect(effectiveSidecarWidth(440, true, 960)).toBe(480);
    expect(effectiveSidecarWidth(640, true, 960)).toBe(640);
  });

  it("widens the drawer, lifts the result cap and is remembered across a reopen", async () => {
    setViewport(1440);
    await mount();
    await pressCmdJ();
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { toggle()!.click(); });
    expect((drawer() as HTMLElement).style.width).toBe("960px");
    expect(drawer()!.classList.contains("sidecar-drawer--wide")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--sidecar-w")).toBe("960px");
    expect(localStorage.getItem("ndx-sidecar-wide")).toBe("1");
    await pressCmdJ();
    await pressCmdJ();
    expect((drawer() as HTMLElement).style.width).toBe("960px");
    await act(async () => { toggle()!.click(); });
    expect((drawer() as HTMLElement).style.width).toBe("440px");
    expect(localStorage.getItem("ndx-sidecar-wide")).toBe("0");
  });

  it("leaves wide mode when the edge is resized", async () => {
    setViewport(1440);
    localStorage.setItem("ndx-sidecar-wide", "1");
    await mount();
    await pressCmdJ();
    const edge = root.querySelector<HTMLElement>(".sidecar-resize")!;
    expect(edge.getAttribute("aria-valuemax")).toBe("960");
    // Widening a wide drawer is a no-op, not a snap back to the stored width.
    for (const key of ["ArrowLeft", "End"]) {
      await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
      expect((drawer() as HTMLElement).style.width).toBe("960px");
    }
    // Arrow-Right narrows by one step from the shown width and stays wide.
    await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect((drawer() as HTMLElement).style.width).toBe("940px");
    expect(drawer()!.classList.contains("sidecar-drawer--wide")).toBe(true);
    await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect((drawer() as HTMLElement).style.width).toBe("960px");
    for (let i = 0; i < 15; i++) {
      await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    }
    expect((drawer() as HTMLElement).style.width).toBe("660px");
    expect(drawer()!.classList.contains("sidecar-drawer--wide")).toBe(true);
    // Back inside 360–640: wide mode ends.
    await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect((drawer() as HTMLElement).style.width).toBe("640px");
    expect(drawer()!.classList.contains("sidecar-drawer--wide")).toBe(false);
    await act(async () => { edge.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
    expect((drawer() as HTMLElement).style.width).toBe("360px");
  });

  it("follows the pointer when dragging inward from wide mode, with no jump", async () => {
    setViewport(1440);
    localStorage.setItem("ndx-sidecar-wide", "1");
    await mount();
    await pressCmdJ();
    const edge = root.querySelector<HTMLElement>(".sidecar-resize")!;
    const move = async (x: number) => act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: x })); });
    await act(async () => { edge.dispatchEvent(new MouseEvent("pointerdown", { clientX: 500, bubbles: true, cancelable: true })); });
    await move(505);
    expect((drawer() as HTMLElement).style.width).toBe("955px");
    expect(drawer()!.classList.contains("sidecar-drawer--wide")).toBe(true);
    await move(700);
    expect((drawer() as HTMLElement).style.width).toBe("760px");
    await move(400);
    expect((drawer() as HTMLElement).style.width).toBe("960px");
    await move(900);
    expect((drawer() as HTMLElement).style.width).toBe("560px");
    expect(drawer()!.classList.contains("sidecar-drawer--wide")).toBe(false);
    // Out of wide mode, the same drag resizes within 360–640.
    await move(800);
    expect((drawer() as HTMLElement).style.width).toBe("640px");
    window.dispatchEvent(new MouseEvent("pointerup"));
  });

  it("works with storage blocked", async () => {
    setViewport(1440);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await mount();
    await pressCmdJ();
    await act(async () => { toggle()!.click(); });
    expect((drawer() as HTMLElement).style.width).toBe("960px");
  });

  it("keeps the drawer usable on a narrow viewport: no toggle, no wide, at most 85%", async () => {
    setViewport(800);
    localStorage.setItem("ndx-sidecar-wide", "1");
    await mount();
    await pressCmdJ();
    expect(toggle()).toBeNull();
    expect(drawer()!.classList.contains("sidecar-drawer--wide")).toBe(false);
    expect((drawer() as HTMLElement).style.width).toBe("440px");
    expect(effectiveSidecarWidth(640, false, 500)).toBe(425);
  });

  it("styles the toggle and lifts the cap with tokens only", () => {
    const css = readFileSync(join(__dirname, "../../../src/viewer/styles/sidecar.css"), "utf8");
    expect(css).toMatch(/\.sidecar-drawer--wide \.sidecar-tool-output \{ max-height: none; \}/);
    expect(css).toMatch(/\.sidecar-wide-toggle\.active \{[^}]*var\(--bg-active\)/);
  });
});

// ── Transcript ─────────────────────────────────────────────────────────────

describe("a page handed off with ?sidecar=<id>", () => {
  beforeEach(() => {
    // "recent" is the session the drawer would pick on its own.
    server.sessions = [
      { session: session({ id: "handed", lastActivityAt: "2026-10-28T09:00:00.000Z" }), running: false },
      { session: session({ id: "recent", lastActivityAt: "2026-10-28T11:00:00.000Z" }), running: false },
    ];
    server.frames = [user(1, "Handed-off question")];
    history.replaceState(null, "", "/?sidecar=handed");
  });
  afterEach(() => history.replaceState(null, "", "/"));

  it("opens the drawer on that session and reads its frames, though another is more recent", async () => {
    await mount();
    expect(drawer()).not.toBeNull();
    expect(rows()).toEqual(["Handed-off question"]);
    expect(frameFetches()).toContain("/api/sidecar/sessions/handed/frames?after=0");
    expect(frameFetches().some((u) => u.includes("/sessions/recent/"))).toBe(false);
  });

  it("leaves the drawer closed and reads no session with web.sidecar off", async () => {
    server.enabled = false;
    await mount();
    expect(drawer()).toBeNull();
    expect(server.requests.some((r) => r.url.startsWith("/api/sidecar"))).toBe(false);
  });
});

describe("the transcript", () => {
  beforeEach(() => {
    server.sessions = [{ session: session({ cursor: 2 }), running: false }];
    server.frames = [user(1, "What is zone 3?"), said(2, "A cluster of web files.")];
  });

  it("fetches the frames after its cursor on each sidecar:frames for the open session", async () => {
    await mount();
    await pressCmdJ();
    expect(rows()).toEqual(["What is zone 3?", "A cluster of web files."]);
    expect(frameFetches()).toEqual(["/api/sidecar/sessions/s1/frames?after=0"]);

    server.frames.push(said(3, "It has 12 files."));
    await announce({ type: "sidecar:frames", sessionId: "s1", cursor: 3, running: true, timestamp: "t" });
    expect(frameFetches().at(-1)).toBe("/api/sidecar/sessions/s1/frames?after=2");
    expect(rows()).toEqual(["What is zone 3?", "A cluster of web files.", "It has 12 files."]);

    // Another session's frames, and a cursor it already holds, fetch nothing.
    const count = frameFetches().length;
    await announce({ type: "sidecar:frames", sessionId: "other", cursor: 9, running: true, timestamp: "t" });
    await announce({ type: "sidecar:frames", sessionId: "s1", cursor: 3, running: false, status: "completed", timestamp: "t" });
    expect(frameFetches().length).toBe(count);
  });

  it("resumes after a reload with no duplicate frames", async () => {
    server.frames.push(said(3, "It has 12 files."));
    await mount();
    await pressCmdJ();
    expect(rows()).toHaveLength(3);
    await unmount();

    await mount();
    await pressCmdJ();
    await announce({ type: "sidecar:frames", sessionId: "s1", cursor: 3, running: false, status: "completed", timestamp: "t" });
    expect(rows()).toEqual(["What is zone 3?", "A cluster of web files.", "It has 12 files."]);
  });

  it("draws a context-refreshed frame as a divider naming the notes carried over", async () => {
    server.frames.push({ seq: 3, at: "t", type: "context-refreshed", notes: 4, contextTokens: 120_000 });
    await mount();
    await pressCmdJ();
    const divider = root.querySelector(".sidecar-divider");
    expect(divider?.getAttribute("role")).toBe("separator");
    expect(divider?.textContent).toBe("Context refreshed · 4 notes carried over");
  });

  it("hides checkpoint events, which are not part of the conversation", () => {
    const host = document.createElement("ol");
    render(h(SidecarFrameRow, { frame: { seq: 1, at: "t", type: "event", event: { type: "assistant", text: "ledger" }, checkpoint: true } }), host);
    expect(host.children).toHaveLength(0);
  });
});

// ── Composer ───────────────────────────────────────────────────────────────

describe("the composer", () => {
  async function type(text: string): Promise<void> {
    const input = root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
    await act(async () => {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit(): Promise<void> {
    await act(async () => {
      root.querySelector("form.sidecar-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  it("posts the prompt to the turns route, is disabled while the turn runs, and Stop interrupts it", async () => {
    server.sessions = [{ session: session(), running: false }];
    await mount();
    await pressCmdJ();
    await type("Explain zone 3");
    await submit();

    const turn = server.requests.find((r) => r.url.endsWith("/turns"));
    expect(turn).toEqual({ method: "POST", url: "/api/sidecar/sessions/s1/turns", body: { prompt: "Explain zone 3" } });
    const input = root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe("");
    expect(root.querySelector<HTMLButtonElement>(".sidecar-send")!.disabled).toBe(true);

    await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-stop")!.click(); });
    await settle();
    expect(server.requests.some((r) => r.method === "POST" && r.url === "/api/sidecar/sessions/s1/interrupt")).toBe(true);

    // The closing announcement frees the composer.
    server.running = false;
    await announce({ type: "sidecar:frames", sessionId: "s1", cursor: 1, running: false, status: "interrupted", timestamp: "t" });
    expect(input.disabled).toBe(false);
    expect(root.querySelector(".sidecar-stop")).toBeNull();
  });

  it("is not disabled again by a frames read taken before the turn ended", async () => {
    server.sessions = [{ session: session(), running: false }];
    await mount();
    await pressCmdJ();
    await type("Explain zone 3");
    await submit();

    // A frame is announced while the turn runs; its read is held at the server.
    let release!: () => void;
    server.gate = new Promise<void>((r) => { release = r; });
    server.frames.push(said(1, "Zone 3 is…"));
    await announce({ type: "sidecar:frames", sessionId: "s1", cursor: 1, running: true, timestamp: "t" });
    // The turn ends before that read answers "running".
    server.running = false;
    await announce({ type: "sidecar:frames", sessionId: "s1", cursor: 1, running: false, status: "completed", timestamp: "t" });
    server.gate = null;
    await act(async () => { release(); });
    await settle();

    expect(rows()).toEqual(["Zone 3 is…"]);
    expect(root.querySelector<HTMLTextAreaElement>(".sidecar-input")!.disabled).toBe(false);
  });

  it("creates a session with the configured vendor when there is none", async () => {
    await mount();
    await pressCmdJ();
    await type("Hello");
    await submit();
    expect(server.requests.find((r) => r.method === "POST" && r.url === "/api/sidecar/sessions")?.body)
      .toEqual({ vendor: "codex", model: "gpt-5.5" });
    expect(server.requests.some((r) => r.url === "/api/sidecar/sessions/new/turns")).toBe(true);
  });
});

// ── Socket reconnect ───────────────────────────────────────────────────────

describe("the socket", () => {
  /** The server goes away: every open socket closes. */
  function dropSockets(): void {
    for (const socket of [...FakeSocket.open]) { FakeSocket.open.delete(socket); socket.onclose?.(); }
  }

  it("reconnects after a drop and catches up on cards and frames", async () => {
    server.sessions = [{ session: session(), running: false }];
    await mount();
    await pressCmdJ();
    const input = () => root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
    await act(async () => {
      input().value = "Explain zone 3";
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      root.querySelector("form.sidecar-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(input().disabled).toBe(true);

    // The socket drops mid-turn; while it is down a card is raised and the turn ends.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    dropSockets();
    server.cards.push(card("c1", 1));
    server.frames.push(said(1, "Zone 3 is…"));
    server.running = false;
    expect(root.querySelector(".sidecar-card")).toBeNull();

    // Before the first backoff step nothing reopens; at it, the hook reopens through openWebSocket.
    vi.advanceTimersByTime(999);
    expect(FakeSocket.open.size).toBe(0);
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    // Other listeners in the shell reconnect too; only Sidecar's catches up on cards and frames below.
    expect(FakeSocket.open.size).toBeGreaterThan(0);
    await act(async () => { for (const socket of FakeSocket.open) socket.onopen?.(); });
    await settle();

    expect(root.querySelector(".sidecar-card")).not.toBeNull();
    expect(rows()).toEqual(["Zone 3 is…"]);
    expect(input().disabled).toBe(false);
  });

  it("stops retrying once unmounted", async () => {
    await mount();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    dropSockets();
    await unmount();
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();
    expect(FakeSocket.open.size).toBe(0);
  });
});

// ── Agent picker ───────────────────────────────────────────────────────────

describe("the agent picker", () => {
  const created = () => server.requests.filter((r) => r.method === "POST" && r.url === "/api/sidecar/sessions");

  async function pick(selector: string, value: string): Promise<void> {
    const el = root.querySelector<HTMLSelectElement>(selector)!;
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  }

  it("lists the resumable vendors and the chosen vendor's models from /api/llm/catalog", async () => {
    await mount();
    await pressCmdJ();
    expect(server.requests.some((r) => r.url === "/api/llm/catalog")).toBe(true);
    const options = (sel: string) => [...root.querySelectorAll(`${sel} option`)].map((o) => o.textContent);
    expect(options(".sidecar-vendor")).toEqual(["Claude", "Codex"]);
    expect(options(".sidecar-model")).toEqual(["gpt-5.5", "gpt-5.5-mini"]);
    const values = (sel: string) => [...root.querySelectorAll<HTMLOptionElement>(`${sel} option`)].map((o) => o.value);
    expect(values(".sidecar-vendor")).toEqual(["claude", "codex"]);
    expect(values(".sidecar-model")).toEqual(["gpt-5.5", "gpt-5.5-mini"]);
  });

  it("labels each picker visibly and shows readable Claude model names over the ids", async () => {
    await mount();
    await pressCmdJ();
    for (const [sel, text] of [[".sidecar-vendor", "Agent"], [".sidecar-model", "Model"]] as const) {
      const select = root.querySelector<HTMLSelectElement>(sel)!;
      const label = root.querySelector<HTMLLabelElement>(`label[for="${select.id}"]`)!;
      expect(label.textContent).toBe(text);
    }
    await pick(".sidecar-vendor", "claude");
    const opts = [...root.querySelectorAll<HTMLOptionElement>(".sidecar-model option")];
    expect(opts.map((o) => o.textContent)).toEqual(["Sonnet 5.5", "Haiku 4.5"]);
    expect(opts.map((o) => o.value)).toEqual(["claude-sonnet-5-5", "claude-haiku-4-5"]);
    expect(opts.map((o) => o.title)).toEqual(["claude-sonnet-5-5", "claude-haiku-4-5"]);
  });

  it("styles the header controls and pickers from tokens only", () => {
    const css = readFileSync(join(process.cwd(), "src/viewer/styles/sidecar.css"), "utf8");
    const rule = (sel: string) => css.match(new RegExp(`${escapeRegExp(sel)}\\s*\\{([^}]*)\\}`))![1]!;
    expect(rule(".sidecar-tab.active")).toMatch(/background: var\(--bg-active\)[\s\S]*color: var\(--text\)/);
    expect(rule(".sidecar-tab")).toMatch(/color: var\(--text-dim\)/);
    expect(rule(".sidecar-sessions-toggle.active")).toMatch(/background: var\(--bg-active\)/);
    expect(rule(".sidecar-agent select")).toMatch(/var\(--bg-surface\)[\s\S]*var\(--border\)[\s\S]*var\(--radius-md\)/);
    expect(rule(".sidecar-close")).toMatch(/width: var\(--space-8\)/);
    for (const sel of [".sidecar-tab", ".sidecar-sessions-toggle", ".sidecar-close", ".sidecar-agent select", ".sidecar-field-label"]) {
      expect(rule(sel)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("renders the lens pill, textarea, hint and Send in one composer card", async () => {
    await mount();
    await pressCmdJ();
    const card = root.querySelector(".sidecar-composer > .sidecar-composer-card")!;
    expect(card).not.toBeNull();
    expect(card.querySelector(".sidecar-chip-lens")!.getAttribute("aria-label")).toMatch(/^Lens: /);
    expect(card.querySelector<HTMLTextAreaElement>("textarea.sidecar-input")!.placeholder)
      .toBe("Ask about this project, or tell the agent what to do…");
    expect(card.querySelector(".sidecar-composer-hint")!.textContent).toBe("Enter to send · Shift+Enter for a new line");
    expect(card.querySelector<HTMLButtonElement>(".sidecar-send")!.disabled).toBe(true);
  });

  it("styles the composer card, lens pill and Send from tokens only", () => {
    const css = readFileSync(join(process.cwd(), "src/viewer/styles/sidecar.css"), "utf8");
    const rule = (sel: string) => css.match(new RegExp(`${escapeRegExp(sel)}\\s*\\{([^}]*)\\}`))![1]!;
    expect(rule(".sidecar-composer-card")).toMatch(/var\(--bg-surface\)[\s\S]*var\(--border\)[\s\S]*var\(--radius-xl\)/);
    expect(rule(".sidecar-composer-card:focus-within")).toMatch(/var\(--accent\)/);
    expect(rule(".sidecar-input")).toMatch(/background: transparent[\s\S]*font-size: 14px/);
    expect(rule(".sidecar-send")).toMatch(/background: var\(--accent\)[\s\S]*color: var\(--bg\)/);
    expect(rule(".sidecar-send, .sidecar-stop")).toMatch(/height: 36px/);
    expect(rule(".sidecar-chip-lens")).toMatch(/color-mix\(in srgb, var\(--accent\)[\s\S]*color: var\(--accent\)/);
    // The visible "Lens:" prefix and chevron are drawn in CSS, so the chip text stays the lens name.
    expect(rule(".sidecar-chip-lens::before")).toMatch(/content: "Lens:"/);
    expect(rule(".sidecar-chip-lens::after")).toMatch(/var\(--select-chevron\)/);
    for (const sel of [".sidecar-composer-card", ".sidecar-input", ".sidecar-send", ".sidecar-send:disabled", ".sidecar-stop", ".sidecar-chip-lens"]) {
      expect(rule(sel)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("creates the first session with the chosen vendor and model", async () => {
    await mount();
    await pressCmdJ();
    await pick(".sidecar-vendor", "claude");
    await pick(".sidecar-model", "claude-haiku-4-5");
    expect(created()).toHaveLength(0);
    root.querySelector<HTMLTextAreaElement>(".sidecar-input")!.value = "Hi";
    await act(async () => { root.querySelector<HTMLTextAreaElement>(".sidecar-input")!.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { root.querySelector("form.sidecar-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();
    expect(created().map((r) => r.body)).toEqual([{ vendor: "claude", model: "claude-haiku-4-5" }]);
  });

  it("starts a new session when the vendor or model changes, leaving the old one resumable", async () => {
    server.sessions = [{ session: session({ model: "claude-sonnet-5-5" }), running: false }];
    await mount();
    await pressCmdJ();
    expect(root.querySelector<HTMLSelectElement>(".sidecar-vendor")!.value).toBe("claude");

    await pick(".sidecar-model", "claude-haiku-4-5");
    expect(created().map((r) => r.body)).toEqual([{ vendor: "claude", model: "claude-haiku-4-5" }]);

    await pick(".sidecar-vendor", "codex");
    expect(created().map((r) => r.body)).toEqual([
      { vendor: "claude", model: "claude-haiku-4-5" },
      { vendor: "codex", model: "gpt-5.5" },
    ]);
    // Nothing ended the first session; it is still on the server, not ended.
    expect(server.requests.some((r) => r.url.endsWith("/end"))).toBe(false);
    expect(server.sessions.find((e) => e.session.id === "s1")?.session.endedAt).toBeUndefined();
    // Picking what is already open creates nothing.
    await pick(".sidecar-model", "gpt-5.5");
    expect(created()).toHaveLength(2);
  });
});

// ── Drawer state A: the vendor CLI is missing or signed out ───────────────

describe("vendor CLI setup (state A)", () => {
  const setup = () => root.querySelector(".sidecar-setup");
  const input = () => root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;

  it("names the CLI and its install command and disables the composer when the catalog says it is not installed", async () => {
    server.catalogCli = { claude: false };
    server.sessions = [{ session: session(), running: false }];
    await mount();
    await pressCmdJ();
    expect(setup()?.getAttribute("data-reason")).toBe("missing-cli");
    expect(setup()?.textContent).toContain("claude");
    expect(setup()?.querySelector("code")?.textContent).toBe("npm install -g @anthropic-ai/claude-code");
    expect(input().disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>(".sidecar-send")!.disabled).toBe(true);
  });

  it("probes the CLI again on reopen, so installing it clears state A", async () => {
    server.catalogCli = { claude: false };
    server.sessions = [{ session: session(), running: false }];
    await mount();
    await pressCmdJ();
    expect(setup()).not.toBeNull();
    expect(server.requests.some((r) => r.url === "/api/llm/catalog?refresh=true")).toBe(false);

    server.catalogCli = { claude: true };
    await pressCmdJ();
    await pressCmdJ();
    expect(server.requests.some((r) => r.url === "/api/llm/catalog?refresh=true")).toBe(true);
    expect(setup()).toBeNull();
    expect(input().disabled).toBe(false);
  });

  it("says nothing about a vendor whose CLI is installed", async () => {
    server.catalogCli = { claude: false, codex: true };
    await mount();
    await pressCmdJ();
    expect(setup()).toBeNull();
    expect(input().disabled).toBe(false);
  });

  it("names the vendor's login command when a turn fails with the recorded sign-in error", async () => {
    server.sessions = [{ session: session(), running: false }];
    await mount();
    await pressCmdJ();
    expect(setup()).toBeNull();

    await announce({
      type: "sidecar:frames", sessionId: "s1", cursor: 2, running: false, status: "failed",
      error: "Not logged in · Please run /login", signedOut: true, timestamp: "t",
    });
    expect(setup()?.getAttribute("data-reason")).toBe("signed-out");
    expect(setup()?.querySelector("code")?.textContent).toBe("claude /login");

    // After the login, sending again is the retry: the composer stays on, and the send clears state A.
    expect(input().disabled).toBe(false);
    await act(async () => {
      input().value = "again";
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      root.querySelector("form.sidecar-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(server.requests.some((r) => r.url === "/api/sidecar/sessions/s1/turns")).toBe(true);
    expect(setup()).toBeNull();
  });

  it("shows the login command after a reload, from the outcome the session kept", async () => {
    server.sessions = [{
      session: session({ lastTurn: { status: "failed", error: "Not logged in · Please run /login", signedOut: true } }),
      running: false,
    }];
    await mount();
    await pressCmdJ();
    expect(setup()?.getAttribute("data-reason")).toBe("signed-out");
    expect(setup()?.querySelector("code")?.textContent).toBe("claude /login");
  });

  it("does not take another failed turn for a sign-in problem", async () => {
    server.sessions = [{ session: session(), running: false }];
    await mount();
    await pressCmdJ();
    await announce({ type: "sidecar:frames", sessionId: "s1", cursor: 2, running: false, status: "failed", error: "rate limited", timestamp: "t" });
    expect(setup()).toBeNull();
    expect(root.querySelector(".sidecar-turn-end")?.textContent).toContain("rate limited");
  });
});

// ── Tool calls ─────────────────────────────────────────────────────────────

describe("tool calls", () => {
  const call = (seq: number, tool: string, input: Record<string, unknown>, id?: string): SidecarFrame => ({
    seq, at: "t", type: "event", event: { type: "tool_use", toolCall: { tool, input, ...(id ? { id } : {}) } },
  });
  const result = (seq: number, tool: string, output: string, callId?: string): SidecarFrame => ({
    seq, at: "t", type: "event",
    event: { type: "tool_result", toolResult: { tool, output, durationMs: 5, ...(callId ? { id: callId } : {}) } },
  });

  it("pairs a result naming its call by id with that call, whatever the order", () => {
    const paired = pairToolResults([
      call(1, "Read", { file_path: "a" }, "toolu_A"), call(2, "Read", { file_path: "b" }, "toolu_B"),
      result(3, "unknown", "B", "toolu_B"), result(4, "unknown", "A", "toolu_A"),
      result(5, "unknown", "stray", "toolu_gone"),
    ]);
    expect([...paired].map(([seq, r]) => [seq, r.output]).sort()).toEqual([[1, "A"], [2, "B"]]);
  });

  it("keeps the order rule for a result without an id beside calls that have one", () => {
    const paired = pairToolResults([
      call(1, "Read", { file_path: "a" }, "toolu_A"), call(2, "shell", { command: "ls" }),
      result(3, "unknown", "A", "toolu_A"), result(4, "unknown", "files"),
    ]);
    expect([...paired].map(([seq, r]) => [seq, r.output]).sort()).toEqual([[1, "A"], [2, "files"]]);
  });

  it("summarizes a call to one line and pairs results with their calls in order", () => {
    expect(summarizeToolInput({ command: "ls\n  -la", cwd: "/" })).toBe("ls -la");
    expect(summarizeToolInput({ a: 1 })).toBe('{"a":1}');
    expect(summarizeToolInput({ command: "x".repeat(200) })).toHaveLength(80);
    const paired = pairToolResults([
      call(1, "Read", { file_path: "a" }), call(2, "Read", { file_path: "b" }),
      result(3, "Read", "A"), result(4, "Read", "B"),
    ]);
    expect([...paired].map(([seq, r]) => [seq, r.output])).toEqual([[1, "A"], [2, "B"]]);
  });

  it("pairs results that name no tool, as Claude's and Codex's function-call results do, with the earliest open call", () => {
    const paired = pairToolResults([
      call(1, "Read", { file_path: "a" }), result(2, "unknown", "A"),
      call(3, "Bash", { command: "ls" }), call(4, "shell", { command: "pwd" }),
      result(5, "shell", "/repo"), result(6, "unknown", "files"),
      result(7, "unknown", "stray"),
    ]);
    expect([...paired].map(([seq, r]) => [seq, r.output]).sort()).toEqual([[1, "A"], [3, "files"], [4, "/repo"]]);
  });

  it("draws collapsed with name and summary, expands to the raw input and the matching result", async () => {
    server.sessions = [{ session: session(), running: false }];
    server.frames = [
      call(1, "Bash", { command: "pnpm test" }),
      call(2, "Read", { file_path: "src/a.ts" }),
      result(3, "Read", "file body"),
      result(4, "Bash", "all green"),
    ];
    await mount();
    await pressCmdJ();

    const tools = [...root.querySelectorAll<HTMLElement>(".sidecar-tool")];
    expect(tools.map((t) => t.querySelector(".sidecar-tool-name")!.textContent)).toEqual(["Bash", "Read"]);
    expect(tools[0].querySelector(".sidecar-tool-summary")!.textContent).toBe("pnpm test");
    expect(tools[0].querySelector(".sidecar-tool-body")).toBeNull();

    await act(async () => { tools[0].querySelector<HTMLButtonElement>(".sidecar-tool-toggle")!.click(); });
    expect(tools[0].querySelector(".sidecar-tool-toggle")!.getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(tools[0].querySelector(".sidecar-tool-input")!.textContent!)).toEqual({ command: "pnpm test" });
    expect(tools[0].querySelector(".sidecar-tool-output")!.textContent).toBe("all green");
    expect(tools[1].querySelector(".sidecar-tool-body")).toBeNull();

    await act(async () => { tools[0].querySelector<HTMLButtonElement>(".sidecar-tool-toggle")!.click(); });
    expect(tools[0].querySelector(".sidecar-tool-body")).toBeNull();
  });

  it("names broker and external tools in plain words, with the wire name only in the details", async () => {
    server.sessions = [{ session: session(), running: false }];
    server.frames = [
      call(1, "mcp__ndx-sidecar__fake__create_ticket", { title: "t" }),
      call(2, "mcp__ndx-sidecar__run_command", { argv: ["ndx", "status"] }),
      result(3, "mcp__ndx-sidecar__run_command", "ok"),
      call(4, "mcp__rex__get_item", { id: "x" }),
    ];
    await mount();
    await pressCmdJ();

    const tools = [...root.querySelectorAll<HTMLElement>(".sidecar-tool")];
    const names = () => tools.map((t) => t.querySelector(".sidecar-tool-name")!.textContent);
    expect(names()).toEqual(["fake · create ticket", "Run command", "get_item"]);
    expect(tools.map((t) => t.querySelector(".sidecar-tool-status")!.textContent)).toEqual(["Running", "Done", "Running"]);
    expect(tools[0].querySelector(".sidecar-tool-dot")!.getAttribute("data-status")).toBe("running");
    expect(tools[0].textContent).not.toContain("mcp__ndx-sidecar__");

    await act(async () => { tools[0].querySelector<HTMLButtonElement>(".sidecar-tool-toggle")!.click(); });
    expect(tools[0].querySelector(".sidecar-tool-wire")!.textContent).toBe("mcp__ndx-sidecar__fake__create_ticket");
  });

  it("reads a card-less call whose result is an error as Failed, keeping its details", async () => {
    server.sessions = [{ session: session(), running: false }];
    server.frames = [
      call(1, "mcp__ndx-sidecar__run_command", { argv: ["rm"] }, "toolu_A"),
      call(2, "mcp__ndx-sidecar__run_command", { argv: ["ls"] }, "toolu_B"),
      result(3, "unknown", "[error] command not allowed", "toolu_A"),
      result(4, "unknown", "ok", "toolu_B"),
    ];
    await mount();
    await pressCmdJ();

    const tools = [...root.querySelectorAll<HTMLElement>(".sidecar-tool")];
    expect(tools.map((t) => t.querySelector(".sidecar-tool-status")!.textContent)).toEqual(["Failed", "Done"]);
    expect(tools.map((t) => t.querySelector(".sidecar-tool-dot")!.getAttribute("data-status"))).toEqual(["failed", "done"]);

    await act(async () => { tools[0].querySelector<HTMLButtonElement>(".sidecar-tool-toggle")!.click(); });
    expect(tools[0].querySelector(".sidecar-tool-output")!.textContent).toBe("[error] command not allowed");
  });

  it("uses the connection's label from its external-call card and shows the waiting state", async () => {
    server.sessions = [{ session: session(), running: true }];
    server.frames = [call(1, "mcp__ndx-sidecar__fake__create_ticket", { title: "t" })];
    server.cards = [card("c1", 1, {
      tool: "external_call", kind: "external-call",
      input: { connection: "fake", tool: "fake.create_ticket", class: "write", arguments: { title: "t" } },
      externalCall: { label: "CAOS", inputSchema: {} },
    })];
    await mount();
    await pressCmdJ();

    const tool = root.querySelector<HTMLElement>(".sidecar-tool")!;
    expect(tool.querySelector(".sidecar-tool-name")!.textContent).toBe("CAOS · create ticket");
    expect(tool.querySelector(".sidecar-tool-status")!.textContent).toBe("Waiting for you");
    expect(tool.querySelector(".sidecar-tool-dot")!.getAttribute("data-status")).toBe("waiting");
  });

  it("leaves a call that raised no card without one, so the next call keeps its own", async () => {
    server.sessions = [{ session: session(), running: true }];
    server.frames = [
      // Allow-listed: ran without a card.
      call(1, "mcp__ndx-sidecar__run_command", { argv: ["ndx", "status", "."] }),
      result(2, "mcp__ndx-sidecar__run_command", "ok"),
      call(3, "mcp__ndx-sidecar__run_command", { argv: ["pnpm", "test"] }),
    ];
    server.cards = [card("c1", 1, { input: { argv: ["pnpm", "test"] } })];
    await mount();
    await pressCmdJ();

    const tools = [...root.querySelectorAll<HTMLElement>(".sidecar-tool")];
    expect(tools.map((t) => t.querySelector(".sidecar-tool-status")!.textContent)).toEqual(["Done", "Waiting for you"]);
  });
});

// ── Badge ──────────────────────────────────────────────────────────────────

describe("the waiting-card badge", () => {
  it("counts pending cards across this worktree's sessions and updates on sidecar:card", async () => {
    server.sessions = [
      { session: session({ id: "s1" }), running: true },
      { session: session({ id: "s2" }), running: true },
      { session: session({ id: "s3", endedAt: "x" }), running: false },
    ];
    server.cards = [card("c1", 1), card("c2", 2, { status: "approved" })];
    await mount();
    expect(root.querySelector(".topnav-sidecar-badge")?.textContent).toBe("1");
    expect(button()?.getAttribute("aria-label")).toBe("Sidecar, 1 waiting");

    server.cards.push(card("c3", 3, { sessionId: "s2" }));
    await announce({ type: "sidecar:card", sessionId: "s2", cardId: "c3", status: "pending", timestamp: "t" });
    expect(root.querySelector(".topnav-sidecar-badge")?.textContent).toBe("2");

    server.cards = server.cards.map((c) => ({ ...c, status: "approved" }));
    await announce({ type: "sidecar:card", sessionId: "s2", cardId: "c3", status: "approved", timestamp: "t" });
    expect(root.querySelector(".topnav-sidecar-badge")).toBeNull();
  });

  it("ignores a card read that a later read has overtaken", async () => {
    server.sessions = [{ session: session(), running: true }];
    server.cards = [card("c1", 1)];
    await mount();
    expect(root.querySelector(".topnav-sidecar-badge")?.textContent).toBe("1");

    // Read A answers "1 waiting"; the card is then approved and read B answers "none".
    server.heldCardReads = [];
    await announce({ type: "sidecar:card", sessionId: "s1", cardId: "c1", status: "pending", timestamp: "t" });
    server.cards[0].status = "approved";
    await announce({ type: "sidecar:card", sessionId: "s1", cardId: "c1", status: "approved", timestamp: "t" });
    expect(server.heldCardReads).toHaveLength(2);
    const [releaseA, releaseB] = server.heldCardReads;
    server.heldCardReads = null;

    // B lands first, then A: A was overtaken and must not bring the badge back.
    await act(async () => { releaseB(); });
    await settle();
    expect(root.querySelector(".topnav-sidecar-badge")).toBeNull();
    await act(async () => { releaseA(); });
    await settle();
    expect(root.querySelector(".topnav-sidecar-badge")).toBeNull();
  });
});

// ── Permission cards ───────────────────────────────────────────────────────

describe("permission cards", () => {
  const cardEls = () => [...root.querySelectorAll<HTMLElement>(".sidecar-card")];
  const decisions = () => server.requests.filter((r) => r.method === "POST" && /\/cards\/[\w-]+$/.test(r.url));

  async function key(target: EventTarget, init: KeyboardEventInit): Promise<void> {
    await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
    await settle();
  }

  async function openWith(cards: SidecarCard[]): Promise<void> {
    server.sessions = [{ session: session(), running: true }];
    server.running = true;
    server.cards = cards;
    await mount();
    await pressCmdJ();
  }

  it("draws waiting cards oldest first, lets only the first be decided, and pauses the agent above the composer", async () => {
    await openWith([card("later", 2, { input: { argv: ["ndx", "ci", "."] } }), card("first", 1)]);
    expect(cardEls().map((el) => el.dataset.card)).toEqual(["first", "later"]);
    expect(cardEls()[0].querySelector(".sidecar-card-approve")).not.toBeNull();
    expect(cardEls()[1].querySelector("button")).toBeNull();
    expect(cardEls()[1].querySelector(".sidecar-card-queued")?.textContent).toBe("Decided after the card above");

    const paused = root.querySelector(".sidecar-paused");
    expect(paused?.textContent).toBe("Agent paused · waiting on 2 decisions");
    expect(root.querySelector("form.sidecar-composer")?.previousElementSibling).toBe(paused);
  });

  it("approves the first waiting card on ⌘↵ and denies it on ⌘⌫, but not while focus is in a text field", async () => {
    await openWith([card("c1", 1), card("c2", 2)]);
    const composer = root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
    const note = root.querySelector<HTMLInputElement>(".sidecar-card-reason")!;
    for (const field of [composer, note]) {
      await key(field, { key: "Enter", metaKey: true });
      await key(field, { key: "Backspace", metaKey: true });
    }
    expect(decisions()).toHaveLength(0);

    await key(document.body, { key: "Enter", metaKey: true });
    expect(decisions()).toEqual([{ method: "POST", url: "/api/sidecar/sessions/s1/cards/c1", body: { decision: "approve" } }]);

    await announce({ type: "sidecar:card", sessionId: "s1", cardId: "c1", status: "approved", timestamp: "t" });
    await key(document.body, { key: "Backspace", ctrlKey: true });
    expect(decisions().at(-1)).toEqual({ method: "POST", url: "/api/sidecar/sessions/s1/cards/c2", body: { decision: "deny" } });
  });

  it("leaves ⌘↵ to a page control that already handled it", async () => {
    await openWith([card("c1", 1)]);
    // As the PRD add form does: it submits on ⌘↵ from any field, a select included.
    const select = document.createElement("select");
    select.addEventListener("keydown", (e) => e.preventDefault());
    root.appendChild(select);
    await key(select, { key: "Enter", metaKey: true });
    expect(decisions()).toHaveLength(0);
  });

  it("ignores a held key's auto-repeat, so the next card waits for a fresh press", async () => {
    await openWith([card("c1", 1), card("c2", 2)]);
    await key(document.body, { key: "Enter", metaKey: true });
    await announce({ type: "sidecar:card", sessionId: "s1", cardId: "c1", status: "approved", timestamp: "t" });
    await key(document.body, { key: "Enter", metaKey: true, repeat: true });
    await key(document.body, { key: "Backspace", metaKey: true, repeat: true });
    expect(decisions().map((r) => r.url)).toEqual(["/api/sidecar/sessions/s1/cards/c1"]);
    expect(cardEls().find((el) => el.dataset.card === "c2")?.querySelector(".sidecar-card-approve")).not.toBeNull();
  });

  it("decides no card while the Settings overlay covers the drawer", async () => {
    await openWith([card("c1", 1)]);
    const overlayHost = document.createElement("div");
    document.body.appendChild(overlayHost);
    await act(async () => {
      render(h(SettingsOverlay, { view: "analyze", validViews: VALID, onNavigate: () => {}, onClose: () => {} }), overlayHost);
    });
    await settle();
    const close = overlayHost.querySelector<HTMLButtonElement>(".settings-overlay-close")!;
    await key(close, { key: "Enter", metaKey: true });
    await key(document.body, { key: "Backspace", metaKey: true });
    expect(decisions()).toHaveLength(0);

    await act(async () => { render(null, overlayHost); });
    overlayHost.remove();
    await key(document.body, { key: "Enter", metaKey: true });
    expect(decisions().map((r) => r.url)).toEqual(["/api/sidecar/sessions/s1/cards/c1"]);
  });

  it("does not answer the same card twice while its decision is still being read back", async () => {
    await openWith([card("c1", 1), card("c2", 2)]);
    server.heldCardReads = [];
    await key(document.body, { key: "Enter", metaKey: true });
    await key(document.body, { key: "Enter", metaKey: true });
    expect(decisions().map((r) => r.url)).toEqual(["/api/sidecar/sessions/s1/cards/c1"]);
    const held = server.heldCardReads;
    server.heldCardReads = null;
    await act(async () => { for (const release of held) release(); });
    await settle();
  });

  it("sends a deny's note as the decision reason", async () => {
    await openWith([card("c1", 1)]);
    const note = root.querySelector<HTMLInputElement>(".sidecar-card-reason")!;
    await act(async () => {
      note.value = "after the loop finishes";
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-deny")!.click(); });
    await settle();
    expect(decisions()).toEqual([{
      method: "POST", url: "/api/sidecar/sessions/s1/cards/c1", body: { decision: "deny", reason: "after the loop finishes" },
    }]);
  });

  it("shows a command card's effects from the command manifest, or that it declares none", async () => {
    server.manifest = {
      status: { reads: ["repo", "{prdRead}"], writes: [], llm: [], duration: "~1 s" },
      ci: { reads: ["repo"], writes: [{ path: "ci-report.json", what: "report" }], llm: [{ phase: "x" }], duration: "~6 min" },
      noisy: null,
    };
    await openWith([
      card("a", 1),
      card("b", 2, { input: { argv: ["ndx", "ci", "--format=json", "."] } }),
      card("c", 3, { input: { argv: ["ndx", "bogus"] } }),
      card("d", 4, { input: { argv: ["git", "status"] } }),
      card("e", 5, { input: { argv: ["ndx", "noisy"] } }),
    ]);
    const lines = cardEls().map((el) => el.querySelector(".sidecar-card-effects")?.textContent);
    expect(lines).toEqual([
      "reads repo + .rex/product/ and .rex/changes/ · writes nothing · no LLM · ~1 s",
      "reads repo · writes ci-report.json · 1 LLM phase · ~6 min",
      "no declared effects",
      "no declared effects",
      "no declared effects",
    ]);
    expect(server.requests.filter((r) => r.url === "/api/commands/manifest")).toHaveLength(1);
  });

  it("shows a work card's ndx work --resolve preview before it is decided", async () => {
    const preview = "ndx work --task=t1 .\nTask: Carry it out (pending)\nmodel = \"m\" (from default)";
    await openWith([card("c1", 1, { kind: "work", tool: "start_work", input: { taskId: "t1" }, preview })]);
    expect(root.querySelector(".sidecar-card-preview")?.textContent).toBe(preview);
    expect(root.querySelector(".sidecar-card-approve")).not.toBeNull();
  });

  it("offers \"Always allow\" only when the card has an allow-list key, and remembers the approval", async () => {
    await openWith([card("c1", 1, { allowListKey: JSON.stringify(["ndx", "status", "."]) })]);
    await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-always")!.click(); });
    await settle();
    expect(decisions().map((r) => r.body)).toEqual([{ decision: "approve", remember: true }]);
    await unmount();

    await openWith([card("c2", 1, { kind: "work", tool: "start_work", input: { taskId: "t1" } })]);
    expect(root.querySelector(".sidecar-card-approve")).not.toBeNull();
    expect(root.querySelector(".sidecar-card-always")).toBeNull();
  });

  describe("draft-post card", () => {
    const draft = (): SidecarCard => card("d1", 1, { kind: "draft-post", tool: "draft_github_post", input: { kind: "comment", target: "931", body: "lint fails on main too" } });
    const button = (cls: string) => root.querySelector<HTMLButtonElement>(`.${cls}`)!;

    it("shows the draft as it would be posted, and Post approves it", async () => {
      await openWith([draft()]);
      expect(root.querySelector(".sidecar-draft-target")?.textContent).toBe("Comment on 931");
      expect(root.querySelector(".sidecar-draft-text")?.textContent).toBe("lint fails on main too");
      expect(button("sidecar-card-approve").textContent).toBe("Post under your gh login");
      expect(root.querySelector(".sidecar-card-always")).toBeNull();
      await act(async () => { button("sidecar-card-approve").click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "approve" }]);
    });

    it("Copy puts the draft on the clipboard and denies the card, so nothing is posted", async () => {
      const writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      await openWith([draft()]);
      await act(async () => { button("sidecar-card-copy").click(); });
      await settle();
      expect(writeText).toHaveBeenCalledWith("lint fails on main too");
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "deny", reason: "Copied, not posted" }]);
    });

    it("a refused clipboard leaves the card waiting and says so", async () => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
      await openWith([draft()]);
      await act(async () => { button("sidecar-card-copy").click(); });
      await settle();
      expect(button("sidecar-card-copy").textContent).toBe("Copy failed — select it");
      expect(decisions()).toEqual([]);
    });

    it("Discard denies it", async () => {
      await openWith([draft()]);
      expect(button("sidecar-card-deny").textContent).toBe("Discard");
      await act(async () => { button("sidecar-card-deny").click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "deny" }]);
    });

    it("a hub draft names its project in the title and on the card", async () => {
      await openWith([card("d2", 1, { kind: "draft-post", tool: "draft_github_post", input: { project: "app", kind: "review", target: "931", body: "x" } })]);
      expect(root.querySelector(".sidecar-card-title")?.textContent).toBe("app · review · 931");
      expect(root.querySelector(".sidecar-draft-target")?.textContent).toBe("Review comment on 931 in project app");
    });
  });

  describe("status card", () => {
    const status = (rule: NonNullable<SidecarCard["statusChange"]>["rule"], to = "deferred"): SidecarCard => card("s1", 1, {
      kind: "status", tool: "propose_status", allowListKey: null,
      input: { id: "t1", status: to },
      statusChange: { itemId: "t1", itemTitle: "Write the cache", from: "in_progress", to, reason: "waiting on design", rule },
    });

    it("shows the move and rex's rule, offers no always-allow, and Approve sends a plain approval", async () => {
      await openWith([status({ allowed: true })]);
      expect(root.querySelector(".sidecar-card-title")?.textContent).toBe("t1: in progress → deferred");
      expect(root.querySelector(".sidecar-status-item")?.textContent).toBe("t1 Write the cache");
      expect(root.querySelector(".sidecar-status-move")?.textContent).toBe("in progress → deferred");
      expect(root.querySelector(".sidecar-status-reason")?.textContent).toBe("Why: waiting on design");
      expect(root.querySelector(".sidecar-status-rule")?.textContent).toBe("Rex allows this move without force.");
      expect(root.querySelector(".sidecar-card-always")).toBeNull();
      await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-approve")!.click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "approve" }]);
    });

    it("quotes rex's refusal on a move rex will not make", async () => {
      await openWith([status({ allowed: false, message: 'Cannot move from "completed" to "pending".' }, "pending")]);
      expect(root.querySelector(".sidecar-status-refused")?.textContent).toBe('Rex refuses this move: Cannot move from "completed" to "pending".');
    });
  });

  describe("item-edit card", () => {
    const edit = (): SidecarCard => card("e1", 1, {
      kind: "item-edit", tool: "propose_item_edit", allowListKey: null,
      input: { id: "t1", acceptanceCriteria: ["Loads fast", "Loads in under 1 s"], tags: ["ui"] },
      itemEdit: {
        itemId: "t1", itemTitle: "Write the cache",
        before: { acceptanceCriteria: ["Loads fast", "Works"], tags: [] },
        after: { acceptanceCriteria: ["Loads fast", "Loads in under 1 s"], tags: ["ui"] },
      },
    });
    const field = (name: string) => root.querySelector(`.sidecar-item-edit-field[data-field="${name}"]`)!;

    it("shows each field before and after, offers no always-allow, and Approve sends no edits when none were made", async () => {
      await openWith([edit()]);
      expect(root.querySelector(".sidecar-card-title")?.textContent).toBe("t1: acceptanceCriteria, tags");
      expect(root.querySelector(".sidecar-item-edit-item")?.textContent).toBe("t1 Write the cache");
      const marks = [...field("acceptanceCriteria").querySelectorAll("li")].map((li) => [li.className, li.textContent?.trim()]);
      expect(marks).toEqual([
        ["sidecar-item-edit-removed", "− Works"],
        ["sidecar-item-edit-kept", "Loads fast"],
        ["sidecar-item-edit-added", "+ Loads in under 1 s"],
      ]);
      expect(root.querySelector(".sidecar-card-always")).toBeNull();
      expect(root.querySelector(".sidecar-card-approve")?.textContent).toBe("Approve and write");
      await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-approve")!.click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "approve" }]);
    });

    it("sends the operator's edited values with the approval, and the diff follows them", async () => {
      await openWith([edit()]);
      const tags = field("tags").querySelector<HTMLTextAreaElement>("textarea")!;
      await act(async () => { tags.value = "ui\ncache"; tags.dispatchEvent(new Event("input", { bubbles: true })); });
      expect([...field("tags").querySelectorAll("li.sidecar-item-edit-added")].map((li) => li.textContent?.trim())).toEqual(["+ ui", "+ cache"]);
      await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-approve")!.click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "approve", edits: { tags: ["ui", "cache"] } }]);
    });

    it("sends no edits with a denial", async () => {
      await openWith([edit()]);
      const tags = field("tags").querySelector<HTMLTextAreaElement>("textarea")!;
      await act(async () => { tags.value = "other"; tags.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-deny")!.click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "deny" }]);
    });
  });

  describe("draft-file card", () => {
    const file = (): SidecarCard => card("f1", 1, { kind: "draft-file", tool: "save_draft", input: { kind: "restack-plan", path: "/h/hub/drafts/restack.md", content: "1. rebase #12" } });
    const pathInput = () => root.querySelector<HTMLInputElement>(".sidecar-draft-path-input")!;

    it("shows the path and the content, offers no always-allow, and Save approves at the shown path", async () => {
      await openWith([file()]);
      expect(root.querySelector(".sidecar-card-title")?.textContent).toBe("restack-plan · /h/hub/drafts/restack.md");
      expect(pathInput().value).toBe("/h/hub/drafts/restack.md");
      expect(root.querySelector(".sidecar-draft-text")?.textContent).toBe("1. rebase #12");
      expect(root.querySelector(".sidecar-card-always")).toBeNull();
      expect(root.querySelector(".sidecar-card-approve")?.textContent).toBe("Save file");
      await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-approve")!.click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "approve", path: "/h/hub/drafts/restack.md" }]);
    });

    it("saves at the path the operator edited, and a denial carries no path", async () => {
      await openWith([file()]);
      await act(async () => {
        pathInput().value = "/tmp/plan.md";
        pathInput().dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-approve")!.click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "approve", path: "/tmp/plan.md" }]);
    });

    it("Deny sends no path", async () => {
      await openWith([file()]);
      await act(async () => { root.querySelector<HTMLButtonElement>(".sidecar-card-deny")!.click(); });
      await settle();
      expect(decisions().map((r) => r.body)).toEqual([{ decision: "deny" }]);
    });
  });

  it("a network-read card names what gh reads, and \"Allow GitHub reads for this project\" approves it and turns the setting on", async () => {
    await openWith([card("n1", 1, { kind: "network-read", tool: "github_read", input: { kind: "check", ref: "lint", base: "main" } })]);
    expect(root.querySelector(".sidecar-network-read")?.textContent).toBe('Reads github.com with your gh login: the newest run of check "lint" on main.');
    const allow = root.querySelector<HTMLButtonElement>(".sidecar-card-always")!;
    expect(allow.textContent).toBe("Allow GitHub reads for this project");
    await act(async () => { allow.click(); });
    await settle();
    expect(decisions().map((r) => r.body)).toEqual([{ decision: "approve" }]);
    expect(server.requests.filter((r) => r.url === "/api/sidecar/settings")).toEqual([
      { method: "PUT", url: "/api/sidecar/settings", body: { githubReads: true } },
    ]);
  });

  const INPUTS: Record<SidecarCardKind, { tool: string; input: Record<string, unknown>; title: string }> = {
    command: { tool: "run_command", input: { argv: ["ndx", "status", "."] }, title: "ndx status ." },
    work: { tool: "start_work", input: { taskId: "425819f5", options: { review: true } }, title: "n-dx work --task=425819f5 --auto --review ." },
    "change-set": { tool: "propose_prd_change", input: { items: [{ title: "a" }, { title: "b" }] }, title: "2 items" },
    // Without its plan (a card from before the plan was read) the title falls back to the tool.
    "run-plan": { tool: "propose_run_plan", input: { note: "two lanes" }, title: "propose_run_plan" },
    placement: { tool: "place_change_card", input: { change: "CH-212", target: "A3.2", relation: "amends" }, title: "CH-212 → A3.2" },
    edit: { tool: "propose_edit", input: { path: "src/a.ts", diff: "-a\n+b" }, title: "src/a.ts" },
    // Without its link (a card from before the link was read) the title is the call's own.
    link: { tool: "propose_link", input: { itemId: "t1", ref: "WM-2054" }, title: "t1 → WM-2054" },
    // Without its fields (a card from before the item was read) the title is the item's id.
    "item-edit": { tool: "propose_item_edit", input: { id: "t1", tags: ["ui"] }, title: "t1" },
    // Without its change (a card from before the status was read) the title is the item's id.
    status: { tool: "propose_status", input: { id: "t1", status: "deferred" }, title: "t1" },
    "network-read": { tool: "github_read", input: { kind: "pr", ref: "#901" }, title: "pr #901" },
    "draft-post": { tool: "draft_github_post", input: { kind: "comment", target: "#901", body: "hi" }, title: "comment · #901" },
    "draft-file": { tool: "save_draft", input: { kind: "prompt", path: "/h/p.md", content: "go" }, title: "prompt · /h/p.md" },
    "migration-decision": { tool: "migration_decision", input: { entries: [{ id: "x" }] }, title: "1 decision" },
    "external-call": {
      tool: "external_call",
      input: { connection: "docs", tool: "docs.update_item", class: "write", arguments: { id: "7", title: "t" } },
      title: "docs.update_item · write",
    },
  };
  it("draws a link card from the link the server read: the item, the tracker's label and the ref", async () => {
    const host = document.createElement("div");
    await act(async () => {
      render(h(SidecarCards, {
        cards: [card("l", 1, {
          kind: "link", tool: "propose_link", input: { itemId: "t1", ref: "https://tracker.example/items/9" },
          link: { itemId: "t1", title: "Write the cache", ref: "https://tracker.example/items/9", label: "CAOS" },
        })],
        manifest: { cliNames: ["ndx"], effects: {}, layoutPaths: {} },
        decide: vi.fn(async () => true),
      }), host);
    });
    expect(host.querySelector(".sidecar-card-title")?.textContent).toBe("t1 → CAOS tracker.example");
    expect(host.querySelector(".sidecar-link-item")?.textContent).toBe("t1 Write the cache");
    expect(host.querySelector(".sidecar-link-ref a")?.getAttribute("href")).toBe("https://tracker.example/items/9");
    // A link is never allow-listed, so there is nothing to remember.
    expect(host.querySelector(".sidecar-card-always")).toBeNull();
  });

  it("titles a work card from the run options the server attached, not the call's own", async () => {
    const titleOf = async (input: Record<string, unknown>, runOptions: Record<string, unknown>): Promise<string> => {
      const host = document.createElement("div");
      await act(async () => {
        render(h(SidecarCards, {
          cards: [card("w", 1, { kind: "work", tool: "start_work", input, runOptions })],
          manifest: { cliNames: ["ndx"], effects: {}, layoutPaths: {} },
          decide: vi.fn(async () => true),
        }), host);
      });
      return host.querySelector(".sidecar-card-title")?.textContent ?? "";
    };
    expect(await titleOf({ taskId: "t1" }, { requireUnblocked: true })).toBe("n-dx work --task=t1 --auto --require-unblocked .");
    expect(await titleOf({ taskId: "t1", options: { requireUnblocked: false } }, {})).toBe("n-dx work --task=t1 --auto .");
  });
  const STATES: Array<[string, Partial<SidecarCard>, RegExp | null]> = [
    ["pending", { status: "pending" }, null],
    ["approved", { status: "approved" }, /^Approved$/],
    ["denied", { status: "denied", reason: "not now" }, /^Denied · note sent to the agent: "not now"$/],
    ["allow-listed", { status: "approved", remembered: true }, /allow-listed/],
    ["withdrawn", { status: "withdrawn", reason: "The turn stopped before the card was decided" }, /^Withdrawn · The turn stopped/],
  ];

  it.each(Object.keys(INPUTS) as SidecarCardKind[])("draws a %s card with its title and input in every state", async (kind) => {
    const { tool, input, title } = INPUTS[kind];
    for (const [state, over, note] of STATES) {
      const host = document.createElement("div");
      await act(async () => {
        render(h(SidecarCards, {
          cards: [card("x", 1, { kind, tool, input, ...over })],
          manifest: { cliNames: ["ndx"], effects: {}, layoutPaths: {} },
          decide: vi.fn(async () => true),
        }), host);
      });
      const el = host.querySelector<HTMLElement>(".sidecar-card")!;
      expect(el.classList.contains(`sidecar-card--${state}`), `${kind} ${state}`).toBe(true);
      expect(el.querySelector(".sidecar-card-title")?.textContent).toBe(title);
      expect(el.querySelector(".sidecar-card-kind")?.textContent).not.toBe("");
      // A decided card is folded: open it to read its input.
      if (state !== "pending") await act(async () => { el.querySelector<HTMLButtonElement>(".sidecar-card-toggle")!.click(); });
      expect(JSON.parse(el.querySelector(".sidecar-card-input")!.textContent!)).toEqual(input);
      if (note) expect(el.querySelector(".sidecar-card-note")?.textContent).toMatch(note);
      await act(async () => { render(null, host); });
    }
  });

  describe("decided cards fold", () => {
    const draw = async (cards: SidecarCard[]): Promise<HTMLElement> => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      await act(async () => {
        render(h(SidecarCards, { cards, manifest: null, decide: vi.fn(async () => true) }), host);
      });
      return host;
    };
    const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

    it("shows a decided card as its head and note, and expands on demand", async () => {
      const host = await draw([card("d1", 1, { status: "approved" })]);
      const toggle = host.querySelector<HTMLButtonElement>(".sidecar-card-toggle")!;
      expect(host.querySelector(".sidecar-card-title")).not.toBeNull();
      expect(host.querySelector(".sidecar-card-note")?.textContent).toBe("Approved");
      expect(host.querySelector(".sidecar-card-input")).toBeNull();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelector(".sidecar-card-input")).not.toBeNull();
      await click(toggle);
      expect(host.querySelector(".sidecar-card-input")).toBeNull();
      host.remove();
    });

    it("collapses several decided cards behind an N decided toggle and keeps pending cards open", async () => {
      const host = await draw([
        card("d1", 1, { status: "approved" }),
        card("d2", 2, { status: "denied" }),
        card("p1", 3),
      ]);
      expect(host.querySelectorAll(".sidecar-card")).toHaveLength(1);
      expect(host.querySelector(".sidecar-card--pending .sidecar-card-input")).not.toBeNull();
      const toggle = host.querySelector<HTMLButtonElement>(".sidecar-cards-decided-toggle")!;
      expect(toggle.textContent).toBe("2 decided");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelectorAll(".sidecar-card")).toHaveLength(3);
      expect(host.querySelectorAll(".sidecar-card--approved .sidecar-card-input, .sidecar-card--denied .sidecar-card-input")).toHaveLength(0);
      // Pending first, decided after.
      expect(host.querySelector(".sidecar-cards > li:first-child")?.classList.contains("sidecar-card--pending")).toBe(true);
      host.remove();
    });
  });

  describe("effects line layout tokens", () => {
    const effectsLine = async (layoutPaths: Record<string, string>, reads: string[], writes: string[]): Promise<string> => {
      const host = document.createElement("div");
      await act(async () => {
        render(h(SidecarCards, {
          cards: [card("x", 1)],
          manifest: {
            cliNames: ["ndx"],
            effects: { status: { reads, writes: writes.map((path) => ({ path })), llm: [], duration: "fast" } },
            layoutPaths,
          },
          decide: vi.fn(async () => true),
        }), host);
      });
      const text = host.querySelector(".sidecar-card-effects")!.textContent!;
      await act(async () => { render(null, host); });
      return text;
    };

    it("replaces every token with the manifest's layoutPaths value", async () => {
      const line = await effectsLine(
        { prdRead: ".rex/product/ and .rex/changes/", hench: ".hench" },
        ["{prdRead}", "{hench}/runs/"],
        ["{hench}/runs/{hench}/"],
      );
      expect(line).toBe("reads .rex/product/ and .rex/changes/ + .hench/runs/ · writes .hench/runs/.hench/ · no LLM · fast");
    });

    it("leaves a token the manifest does not name as written", async () => {
      const line = await effectsLine({ hench: ".hench" }, ["{prdRead}", "{hench}/runs/"], ["{unknown}"]);
      expect(line).toBe("reads {prdRead} + .hench/runs/ · writes {unknown} · no LLM · fast");
    });
  });

  it("draws a card withdrawn because the session ended as denied with the note \"session ended\"", async () => {
    const host = document.createElement("div");
    await act(async () => {
      render(h(SidecarCards, {
        cards: [card("x", 1, { status: "withdrawn", reason: "session ended" })],
        manifest: null,
        decide: vi.fn(async () => true),
      }), host);
    });
    const el = host.querySelector(".sidecar-card")!;
    expect(el.classList.contains("sidecar-card--denied")).toBe(true);
    expect(el.querySelector(".sidecar-card-note")?.textContent).toBe("Denied · session ended");
    await act(async () => { render(null, host); });
  });
});

// ── Sessions list (story 10) ───────────────────────────────────────────────

describe("sessions list", () => {
  const entry = (id: string, over: Partial<SidecarSessionEntry["session"]> = {}, cost = "$0.42"): SidecarSessionEntry => ({
    session: session({ id, name: `Name ${id}`, model: "claude-sonnet-5-5", lens: "plan", turns: 3, ...over }),
    running: false,
    estimatedCost: { total: cost },
  });
  const rowsEl = () => [...root.querySelectorAll<HTMLElement>(".sidecar-session")];
  const rowFor = (id: string) => root.querySelector<HTMLElement>(`.sidecar-session[data-session="${id}"]`)!;
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); await settle(); };
  const buttons = (row: HTMLElement) => [...row.querySelectorAll("button")].map((b) => b.textContent);

  async function openList(): Promise<void> {
    await mount();
    await pressCmdJ();
    await click(root.querySelector(".sidecar-sessions-toggle"));
  }

  it("draws name, branch, lens, agent, turns, cost and waiting cards, with the branch from /api/workspaces", async () => {
    server.sessions = [entry("s1")];
    server.cards = [card("c1", 1), card("c2", 2)];
    // A branch no other endpoint serves: only /api/workspaces can be its source.
    server.workspaces[0].branch = "feat/from-workspaces";
    await openList();
    const text = rowFor("s1").textContent!;
    for (const part of ["Name s1", "feat/from-workspaces", "plan", "claude · claude-sonnet-5-5", "3 turns", "$0.42", "2 waiting"]) {
      expect(text).toContain(part);
    }
    expect(server.requests.some((r) => r.url === "/api/workspaces")).toBe(true);
    // The header's open-session name owns .sidecar-session-name; a row must not take its styling.
    expect(rowFor("s1").querySelector(".sidecar-session-name")).toBeNull();
    expect(rowFor("s1").querySelector(".sidecar-session-label")?.textContent).toBe("Name s1");
  });

  it("Resume opens the session in the drawer", async () => {
    server.sessions = [entry("s1"), entry("s2", { lastActivityAt: "2026-10-28T11:00:00.000Z" })];
    server.frames = [user(1, "earlier question")];
    await openList();
    await click(buttons(rowFor("s1")).includes("Resume") ? [...rowFor("s1").querySelectorAll("button")].find((b) => b.textContent === "Resume")! : null);
    expect(root.querySelector(".sidecar-sessions")).toBeNull();
    expect(root.querySelector(".sidecar-session-name")?.textContent).toBe("Name s1");
    expect(rows()).toEqual(["earlier question"]);
  });

  it("Rename sends PATCH /api/sidecar/sessions/:id and shows the new name", async () => {
    server.sessions = [entry("s1")];
    await openList();
    await click([...rowFor("s1").querySelectorAll("button")].find((b) => b.textContent === "Rename")!);
    const input = root.querySelector<HTMLInputElement>(".sidecar-session-name-input")!;
    await act(async () => { input.value = "Zone review"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(root.querySelector(".sidecar-session-save"));
    expect(server.requests.find((r) => r.method === "PATCH")).toMatchObject({
      url: "/api/sidecar/sessions/s1", body: { name: "Zone review" },
    });
    expect(rowFor("s1").textContent).toContain("Zone review");
  });

  it("End asks first: Keep calls nothing, End session calls the end route", async () => {
    server.sessions = [entry("s1")];
    await openList();
    const endRequests = () => server.requests.filter((r) => r.url.endsWith("/end"));
    await click(rowFor("s1").querySelector(".sidecar-session-end"));
    expect(endRequests()).toHaveLength(0);
    expect(rowFor("s1").textContent).toContain("End this session?");
    await click([...rowFor("s1").querySelectorAll("button")].find((b) => b.textContent === "Keep")!);
    expect(endRequests()).toHaveLength(0);
    await click(rowFor("s1").querySelector(".sidecar-session-end"));
    await click(rowFor("s1").querySelector(".sidecar-session-end-confirm"));
    expect(endRequests()).toEqual([expect.objectContaining({ method: "POST", url: "/api/sidecar/sessions/s1/end" })]);
    expect(rowFor("s1").textContent).toContain("ended");
  });

  it("an ended session offers its transcript, read-only, with no composer", async () => {
    server.sessions = [entry("s1", { endedAt: "2026-10-28T11:30:00.000Z" })];
    server.frames = [user(1, "old question"), said(2, "old answer")];
    await openList();
    expect(buttons(rowFor("s1"))).not.toContain("End");
    expect(buttons(rowFor("s1"))).not.toContain("Resume");
    await click([...rowFor("s1").querySelectorAll("button")].find((b) => b.textContent === "Transcript")!);
    expect(rows()).toEqual(["old question", "old answer"]);
    expect(root.querySelector(".sidecar-readonly")).not.toBeNull();
    expect(root.querySelector(".sidecar-composer")).toBeNull();
  });

  it("All worktrees adds the other worktrees' sessions, read-only", async () => {
    server.sessions = [entry("s1")];
    server.otherSessions = { feat: [entry("o1", { lastActivityAt: "2026-10-28T09:00:00.000Z" })] };
    await openList();
    expect(rowsEl()).toHaveLength(1);
    expect(server.requests.some((r) => r.url.startsWith("/w/"))).toBe(false);
    await click([...root.querySelectorAll(".sidecar-sessions-filter-btn")].find((b) => b.textContent === "All worktrees")!);
    expect(server.requests.some((r) => r.url === "/w/feat/api/sidecar/sessions")).toBe(true);
    expect(rowsEl()).toHaveLength(2);
    expect(rowFor("o1").textContent).toContain("feat/other");
    expect(buttons(rowFor("o1"))).toEqual([]);
    expect(buttons(rowFor("s1"))).toEqual(["Resume", "Rename", "End"]);
  });
});

// ── Attachment chip and lens (story 09) ────────────────────────────────────

describe("attachment and lens", () => {
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); await settle(); };
  const patches = () => server.requests.filter((r) => r.method === "PATCH");
  const lensChip = () => root.querySelector(".sidecar-chip-lens")!;
  const itemChip = () => root.querySelector(".sidecar-chip-item");
  const open = async (view: ViewId, page?: Partial<SidecarPageSelection>) => {
    await mount(view, page);
    await pressCmdJ();
  };

  it("maps pages to lenses without a list of its own", () => {
    expect(wantedLensFor(pageItemFor({ view: "prd", zone: null, taskId: "t1" }), false)).toBe("describe");
    expect(wantedLensFor(pageItemFor({ view: "live-task", zone: null, taskId: "t1" }), true)).toBe("diagnose-run");
    expect(wantedLensFor(pageItemFor({ view: "zones", zone: "z", taskId: null }), false)).toBe("explain");
    expect(wantedLensFor(pageItemFor({ view: "product", zone: null, taskId: null, capabilityId: "c" }), false)).toBe("explain");
    expect(wantedLensFor(pageItemFor({ view: "plan", zone: null, taskId: null }), false)).toBe("plan");
    expect(wantedLensFor(pageItemFor({ view: "live", zone: null, taskId: null }), false)).toBe("guide");
    expect(pageItemFor({ view: "files", zone: null, taskId: null })).toBeNull();
    // A lens the registry does not list, or lists unavailable, runs General.
    expect(resolveLens("guide", [{ id: "guide", available: false, needs: "x" }]).running).toBe("general");
    expect(resolveLens("future", [])).toMatchObject({ running: "general", needs: expect.any(String) });
    expect(resolveLens("plan", [{ id: "plan", available: true }])).toEqual({ wanted: "plan", running: "plan" });
    // A lens that needs a task runs General, naming what it needs, until one is attached.
    const diagnose = [{ id: "diagnose-run", available: true, target: { kind: "task", needs: "a task to diagnose" } }];
    expect(resolveLens("diagnose-run", diagnose, null)).toEqual({ wanted: "diagnose-run", running: "general", needs: "a task to diagnose" });
    expect(resolveLens("diagnose-run", diagnose, { kind: "live", label: "Live" }).needs).toBe("a task to diagnose");
    expect(resolveLens("diagnose-run", diagnose, { kind: "task", ref: "t1", label: "t1" })).toEqual({ wanted: "diagnose-run", running: "diagnose-run" });
  });

  it("a Workspaces worktree card attaches as a worktree, keyed by workspace, and defaults to Diagnose branch", () => {
    const item = pageItemFor({ view: "workspaces", zone: null, taskId: null, worktree: "sidecar-l2" });
    expect(item).toEqual({ kind: "worktree", ref: "sidecar-l2", label: "sidecar-l2" });
    expect(wantedLensFor(item, false)).toBe("diagnose-branch");
    // The Workspaces page with no card attached is about nothing.
    expect(pageItemFor({ view: "workspaces", zone: null, taskId: null })).toBeNull();
    const branch = [{ id: "diagnose-branch", available: true, target: { kind: "worktree", needs: "a branch or worktree" } }];
    expect(resolveLens("diagnose-branch", branch, null)).toEqual({ wanted: "diagnose-branch", running: "general", needs: "a branch or worktree" });
    expect(resolveLens("diagnose-branch", branch, { kind: "task", ref: "t1", label: "t1" }).needs).toBe("a branch or worktree");
    expect(resolveLens("diagnose-branch", branch, item)).toEqual({ wanted: "diagnose-branch", running: "diagnose-branch" });
  });

  it("a task gives Describe, and the session takes the lens and target through PATCH", async () => {
    server.sessions = [{ session: session({ id: "s1" }), running: false }];
    await open("prd", { taskId: "t1" });
    expect(lensChip().textContent).toBe("Describe");
    expect(itemChip()?.textContent).toContain("t1");
    expect(patches()).toEqual([expect.objectContaining({
      url: "/api/sidecar/sessions/s1", body: { lens: "describe", target: { ref: "t1" } },
    })]);
  });

  it("reports why the open session refused to follow, and not an unrelated earlier error", async () => {
    server.sessions = [{ session: session({ id: "s1" }), running: false }];
    await open("prd");
    // An unrelated drawer error is no reason for the follow to have failed.
    await act(async () => { lastSidecar!.reportError("Card decision refused"); });
    expect(lastSidecar!.followError).toBeNull();
    server.patchError = "Session is busy";
    await act(async () => { render(h(Shell, { view: "prd", page: { taskId: "t1" } }), root); });
    await settle();
    expect(lastSidecar!.followError).toBe("Session is busy");
    expect(root.querySelector(".sidecar-error")?.textContent).toBe("Session is busy");
  });

  it("newSession starts a session on the attachment's lens and target in place of an ended one", async () => {
    server.sessions = [{ session: session({ id: "s1", endedAt: "2026-10-28T11:00:00.000Z" }), running: false }];
    await mount("prd", { taskId: "t1" });
    await pressCmdJ();
    await act(async () => { await lastSidecar!.openSession("s1"); });
    await settle();
    expect(lastSidecar!.session?.id).toBe("s1");
    let ok = false;
    await act(async () => { ok = await lastSidecar!.newSession(); });
    await settle();
    expect(ok).toBe(true);
    expect(server.requests.find((r) => r.method === "POST" && r.url === "/api/sidecar/sessions")?.body)
      .toMatchObject({ lens: "describe", target: { ref: "t1" } });
    expect(lastSidecar!.session?.id).toBe("new");
  });

  describe("New session control", () => {
    const newButtons = () => [...root.querySelectorAll<HTMLButtonElement>(".sidecar-new-session")];
    const posts = () => server.requests.filter((r) => r.method === "POST" && r.url === "/api/sidecar/sessions");
    const openListed = async () => {
      await mount("prd", { taskId: "t1" });
      await pressCmdJ();
      await click(root.querySelector(".sidecar-sessions-toggle"));
    };

    it("the drawer head starts a session with the page attached", async () => {
      server.sessions = [{ session: session({ id: "s1" }), running: false }];
      await open("prd", { taskId: "t1" });
      expect(root.querySelector(".sidecar-head .sidecar-new-session")?.textContent).toBe("New session");
      await click(root.querySelector(".sidecar-head .sidecar-new-session"));
      expect(posts()).toHaveLength(1);
      expect(posts()[0].body).toMatchObject({ lens: "describe", target: { ref: "t1" } });
      expect(lastSidecar!.session?.id).toBe("new");
    });

    it("the sessions list starts one, closes the list and attaches the page", async () => {
      server.sessions = [{ session: session({ id: "s1" }), running: false }];
      await openListed();
      await click(root.querySelector(".sidecar-sessions .sidecar-new-session"));
      expect(posts()[0].body).toMatchObject({ lens: "describe", target: { ref: "t1" } });
      expect(root.querySelector(".sidecar-sessions")).toBeNull();
      expect(lastSidecar!.session?.id).toBe("new");
    });

    it("the ended-session bar starts one with the page attached", async () => {
      server.sessions = [{ session: session({ id: "s1", endedAt: "2026-10-28T11:00:00.000Z" }), running: false }];
      await open("prd", { taskId: "t1" });
      await act(async () => { await lastSidecar!.openSession("s1"); });
      await settle();
      expect(root.querySelector(".sidecar-composer")).toBeNull();
      await click(root.querySelector(".sidecar-readonly .sidecar-new-session"));
      expect(posts()[0].body).toMatchObject({ lens: "describe", target: { ref: "t1" } });
      expect(lastSidecar!.session?.id).toBe("new");
      expect(root.querySelector(".sidecar-composer")).not.toBeNull();
    });

    it("a refused New session from the list leaves the list and shows why", async () => {
      server.sessions = [{ session: session({ id: "s1" }), running: false }];
      server.createError = "Sidecar is off";
      await openListed();
      await click(root.querySelector(".sidecar-sessions .sidecar-new-session"));
      expect(root.querySelector(".sidecar-sessions")).toBeNull();
      expect(root.querySelector(".sidecar-error")?.textContent).toBe("Sidecar is off");
      expect(lastSidecar!.session?.id).toBe("s1");
    });

    it("the live session it leaves stays in the list and resumes", async () => {
      server.sessions = [{ session: session({ id: "s1", name: "First" }), running: false }];
      await open("prd", { taskId: "t1" });
      await click(newButtons()[0]);
      expect(lastSidecar!.session?.id).toBe("new");
      await click(root.querySelector(".sidecar-sessions-toggle"));
      const first = root.querySelector<HTMLElement>('.sidecar-session[data-session="s1"]')!;
      expect(first).not.toBeNull();
      expect(first.textContent).not.toContain("ended");
      const resume = [...first.querySelectorAll("button")].find((b) => b.textContent === "Resume")!;
      await click(resume);
      expect(lastSidecar!.session?.id).toBe("s1");
    });
  });

  it("a task picked in the tree after the page opened attaches, and re-targets the open session on each pick", async () => {
    server.sessions = [{ session: session({ id: "s1" }), running: false }];
    await open("prd");
    expect(itemChip()).toBeNull();
    expect(lensChip().textContent).toBe("General");
    for (const id of ["t2", "t3"]) {
      await act(async () => { render(h(Shell, { view: "prd", page: { taskId: id } }), root); });
      await settle();
      expect(itemChip()?.textContent).toContain(id);
      expect(lensChip().textContent).toBe("Describe");
    }
    expect(patches().map((r) => r.body)).toEqual([
      { lens: "describe", target: { ref: "t2" } },
      { target: { ref: "t3" } },
    ]);
  });

  it("leaves the session's lens alone until the registry answers", async () => {
    server.sessions = [{ session: session({ id: "s1", lens: "describe", target: { ref: "t1" } }), running: false }];
    let release!: () => void;
    server.lensesGate = new Promise<void>((r) => { release = r; });
    await open("prd", { taskId: "t1" });
    expect(patches()).toEqual([]);
    await act(async () => { release(); });
    await settle();
    expect(lensChip().textContent).toBe("Describe");
    expect(patches()).toEqual([]);
  });

  it("a task whose last run failed gives Diagnose run, shown as not available yet; the session runs General", async () => {
    server.lastRunStatus = "failed";
    server.sessions = [{ session: session({ id: "s1" }), running: false }];
    await open("prd", { taskId: "t1" });
    expect(lensChip().textContent).toBe("Diagnose runnot available yet");
    expect(patches().map((r) => r.body)).toEqual([{ target: { ref: "t1" } }]);
  });

  it.each([
    ["zones", { zone: "api" }, "Explain"],
    ["plan", {}, "Plan"],
  ] as const)("the %s page gives %s", async (view, page, label) => {
    await open(view, page);
    expect(lensChip().textContent).toBe(label);
  });

  it("Live gives Guide, which the registry cannot run yet", async () => {
    await open("live");
    expect(lensChip().textContent).toBe("Guidenot available yet");
  });

  it("a new session starts on the attached lens and target, or on General when the lens is unavailable", async () => {
    await open("zones", { zone: "api" });
    await click(root.querySelector(".sidecar-send")); // nothing typed: no session yet
    const input = root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
    await act(async () => { input.value = "hi"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(root.querySelector(".sidecar-send"));
    expect(server.requests.find((r) => r.method === "POST" && r.url === "/api/sidecar/sessions")?.body)
      .toMatchObject({ lens: "explain", target: { ref: "api" } });
    await unmount();
    server.requests = [];
    server.sessions = [];
    await open("live");
    const live = root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
    await act(async () => { live.value = "hi"; live.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(root.querySelector(".sidecar-send"));
    const created = server.requests.find((r) => r.method === "POST" && r.url === "/api/sidecar/sessions")?.body as Record<string, unknown>;
    expect(created.lens).toBeUndefined();
  });

  it("the chip switches the lens through PATCH; a lens not available yet cannot be picked", async () => {
    server.sessions = [{ session: session({ id: "s1" }), running: false }];
    await open("prd", { taskId: "t1" });
    server.requests = [];
    await click(lensChip());
    const option = (id: string) => root.querySelector<HTMLButtonElement>(`.sidecar-lens-option[data-lens="${id}"]`)!;
    expect(option("guide").disabled).toBe(true);
    expect(option("guide").textContent).toContain("not available yet");
    await click(option("explain"));
    expect(patches().map((r) => r.body)).toEqual([{ lens: "explain" }]);
    expect(lensChip().textContent).toBe("Explain");
    expect(root.querySelector(".sidecar-lens-menu")).toBeNull();
  });

  it("a lens that needs a task is marked and cannot be picked until one is attached", async () => {
    server.lenses = server.lenses.map((l) => l.id === "diagnose-run"
      ? { id: "diagnose-run", available: true, target: { kind: "task", needs: "a task to diagnose" } }
      : l);
    server.sessions = [{ session: session({ id: "s1" }), running: false }];
    await open("plan");
    await click(lensChip());
    const option = () => root.querySelector<HTMLButtonElement>(`.sidecar-lens-option[data-lens="diagnose-run"]`)!;
    expect(option().disabled).toBe(true);
    expect(option().textContent).toContain("needs a task to diagnose");
    server.requests = [];
    await click(option());
    expect(patches()).toEqual([]);
    await unmount();
    await open("prd", { taskId: "t1" });
    await click(lensChip());
    expect(option().disabled).toBe(false);
    expect(option().textContent).not.toContain("needs");
  });

  it("/ in an empty composer opens the lens list; in a typed composer it types", async () => {
    await open("plan");
    const input = root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
    await act(async () => { input.value = "a"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })); });
    expect(root.querySelector(".sidecar-lens-menu")).toBeNull();
    await act(async () => { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })); });
    expect(root.querySelector(".sidecar-lens-menu")).not.toBeNull();
  });

  it("the attachment chip shows the page item as the target and removing it clears the target", async () => {
    server.sessions = [{ session: session({ id: "s1" }), running: false }];
    await open("zones", { zone: "api" });
    expect(itemChip()?.textContent).toContain("api");
    server.requests = [];
    await click(root.querySelector(".sidecar-chip-remove"));
    expect(itemChip()).toBeNull();
    expect(patches().map((r) => r.body)).toEqual([{ target: {} }]);
  });
});

// ── Extension tabs (Sidecar design §17.1) ─────────────────────────────────

describe("extension tabs", () => {
  const tabButtons = () => [...root.querySelectorAll<HTMLButtonElement>(".sidecar-tab")];
  const tab = (id: string) => root.querySelector<HTMLButtonElement>(`.sidecar-tab[data-tab="${id}"]`)!;
  const frameKeyPosts = () => server.requests.filter((r) => r.method === "POST" && r.url.includes("/frame"));
  const iframe = () => root.querySelector<HTMLIFrameElement>("iframe.sidecar-ext-frame");
  const composer = () => root.querySelector<HTMLTextAreaElement>(".sidecar-input")!;
  const press = async (el: Element) => {
    await act(async () => { (el as HTMLElement).click(); });
    await settle();
  };
  const status = () => root.querySelector(".sidecar-ext-status")?.textContent;

  it("shows no strip without a hub, or with no tabs", async () => {
    await mount();
    await pressCmdJ();
    expect(root.querySelector(".sidecar-tabs")).toBeNull();
    await unmount();

    server.hubTabs = [];
    await mount();
    await pressCmdJ();
    expect(root.querySelector(".sidecar-tabs")).toBeNull();
  });

  it("lists Chat first, then each tab in the hub's order, and asks for no key yet", async () => {
    server.hubTabs = [{ name: "zeta", label: "Zeta" }, { name: "alpha", label: "Alpha" }];
    await mount();
    await pressCmdJ();
    expect(tabButtons().map((b) => b.textContent)).toEqual(["Chat", "Zeta", "Alpha"]);
    expect(root.querySelector(".sidecar-title")!.textContent).toBe("Sidecar");
    expect(frameKeyPosts()).toEqual([]);
    expect(iframe()).toBeNull();
  });

  it("exposes the selected tab and the Sessions toggle's pressed state", async () => {
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    await mount();
    await pressCmdJ();
    expect(tabButtons().map((b) => b.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    await press(tab("alpha"));
    expect(tabButtons().map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    const toggle = root.querySelector<HTMLButtonElement>(".sidecar-sessions-toggle")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await press(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("loads the page on first open in an iframe sandboxed exactly, and keeps it across tab switches", async () => {
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    server.frames = [user(1, "hello"), said(2, "hi there")];
    server.sessions = [{ session: session(), running: false }];
    await mount();
    await pressCmdJ();
    await act(async () => {
      composer().value = "half a thought";
      composer().dispatchEvent(new Event("input", { bubbles: true }));
    });

    await press(tab("alpha"));
    expect(frameKeyPosts().map((r) => r.url)).toEqual(["/api/hub/extensions/alpha/frame?project=p1"]);
    const frame = iframe()!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-popups allow-downloads");
    expect(frame.getAttribute("src")).toMatch(/^\/x\/alpha\/~f\/key\d+\/tab\?project=p1$/);

    await press(tab("sidecar"));
    await press(tab("alpha"));
    expect(frameKeyPosts()).toHaveLength(1);
    expect(iframe()).toBe(frame);
    expect(rows()).toEqual(["hello", "hi there"]);
    expect(composer().value).toBe("half a thought");
  });

  it("hides the other tab rather than unmounting it", async () => {
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    await mount();
    await pressCmdJ();
    await press(tab("alpha"));
    expect(root.querySelector<HTMLElement>(".sidecar-chat-panel")!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("#sidecar-tab-alpha")!.hidden).toBe(false);
    await press(tab("sidecar"));
    expect(root.querySelector<HTMLElement>(".sidecar-chat-panel")!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("#sidecar-tab-alpha")!.hidden).toBe(true);
  });

  it("opens the keyed URL in a new window from the pop-out link", async () => {
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    await mount();
    await pressCmdJ();
    await press(tab("alpha"));
    const link = root.querySelector<HTMLAnchorElement>(".sidecar-ext-popout")!;
    expect(link.getAttribute("href")).toBe(iframe()!.getAttribute("src"));
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("offers Reload on a ready tab, which asks for a new key and reloads the frame", async () => {
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    await mount();
    await pressCmdJ();
    await press(tab("alpha"));
    const before = iframe()!.getAttribute("src");
    expect(frameKeyPosts()).toHaveLength(1);

    await press(root.querySelector(".sidecar-ext-reload-frame")!);
    expect(frameKeyPosts()).toHaveLength(2);
    expect(iframe()!.getAttribute("src")).not.toBe(before);
  });

  it("says \"Starting <label>…\" until the sidecar answers", async () => {
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    let release!: () => void;
    server.pageAnswer = () => new Promise<Response>((r) => { release = () => r(new Response("<p>tab</p>")); });
    await mount();
    await pressCmdJ();
    await press(tab("alpha"));
    expect(status()).toBe("Starting Alpha…");
    expect(iframe()).toBeNull();
    await act(async () => { release(); });
    await settle();
    expect(status()).toBeUndefined();
    expect(iframe()).not.toBeNull();
  });

  it("shows the hub's 503 with the log file it names", async () => {
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    server.pageAnswer = () => json({ error: "The alpha sidecar did not answer within 20 s", log: "/home/u/.ndx/logs/alpha.log" }, 503);
    await mount();
    await pressCmdJ();
    await press(tab("alpha"));
    expect(root.querySelector(".sidecar-ext-error")?.textContent).toBe(
      "The alpha sidecar did not answer within 20 s Log: /home/u/.ndx/logs/alpha.log",
    );
    expect(iframe()).toBeNull();
  });

  it("shows \"Expired · Reload\" on a 401, and Reload asks for a new key", async () => {
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    server.pageAnswer = () => json({ error: "The frame key is no longer valid" }, 401);
    await mount();
    await pressCmdJ();
    await press(tab("alpha"));
    expect(status()).toBe("Expired · Reload");
    expect(frameKeyPosts()).toHaveLength(1);

    server.pageAnswer = undefined;
    await press(root.querySelector(".sidecar-ext-reload")!);
    expect(frameKeyPosts()).toHaveLength(2);
    expect(iframe()).not.toBeNull();
  });

  it("under /p/<id>/ asks for the key under the prefix but probes the page at the hub's own /x/ mount", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      seen.push(String(input));
      return String(input).includes("/frame") ? json({ url: "/x/alpha/~f/k1/tab" }) : new Response("<p>tab</p>");
    }));
    setBasePathForTests("/p/p1");
    try {
      installBasePathFetch();
      const state = await openExtensionTab({ name: "alpha", label: "Alpha" }, "/api/hub/extensions/alpha/frame");
      expect(state).toEqual({ kind: "ready", url: "/x/alpha/~f/k1/tab" });
      expect(seen).toEqual(["/p/p1/api/hub/extensions/alpha/frame", `${location.origin}/x/alpha/~f/k1/tab`]);
    } finally {
      setBasePathForTests(null);
    }
  });

  it("renders no tab and asks for no key while web.sidecar is off", async () => {
    server.enabled = false;
    server.hubTabs = [{ name: "alpha", label: "Alpha" }];
    await mount();
    await pressCmdJ();
    expect(root.querySelector(".sidecar-tabs")).toBeNull();
    expect(server.requests.some((r) => r.url.includes("/frame") || r.url.startsWith("/x/"))).toBe(false);
  });
});
