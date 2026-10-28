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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TopNav } from "../../../src/viewer/components/top-nav.js";
import { SidecarDock, SidecarFrameRow, clampSidecarWidth, pairToolResults, summarizeToolInput } from "../../../src/viewer/components/sidecar-drawer.js";
import {
  isSidecarShortcut,
  mergeFrames,
  pickOpenSession,
  useSidecarShell,
  type SidecarFrame,
  type SidecarSessionEntry,
} from "../../../src/viewer/hooks/use-sidecar.js";
import { useFeatureToggle } from "../../../src/viewer/hooks/use-feature-toggle.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { ViewId } from "../../../src/viewer/types.js";

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
  cards: Array<{ id: string; sessionId: string; status: string }>;
  requests: Array<{ method: string; url: string; body?: unknown }>;
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

function stubServer(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    server.requests.push({ method, url, ...(body !== undefined && { body }) });
    if (url === "/api/features") {
      return json({ toggles: [{ key: "web.sidecar", enabled: server.enabled }] });
    }
    if (url === "/api/project") return json({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory", cliName: "n-dx" });
    if (url === "/api/llm/config") return json({ vendor: "codex" });
    if (url === "/api/llm/catalog") {
      return json({
        claude: { models: ["claude-sonnet-5-5", "claude-haiku-4-5"], defaultModel: "claude-sonnet-5-5" },
        codex: { models: ["gpt-5.5", "gpt-5.5-mini"], defaultModel: "gpt-5.5" },
        google: { models: ["gemini-x"], defaultModel: "gemini-x" },
        local: { models: [], defaultModel: "" },
      });
    }
    if (url === "/api/sidecar/sessions" && method === "GET") return json({ sessions: server.sessions });
    if (url === "/api/sidecar/sessions" && method === "POST") {
      const created = { session: session({ id: "new", vendor: body.vendor, model: body.model }), running: false };
      server.sessions.push(created);
      return json(created, 201);
    }
    const m = /^\/api\/sidecar\/sessions\/([\w-]+)\/(frames|cards|turns|interrupt)(?:\?after=(\d+))?$/.exec(url);
    if (m) {
      const [, id, action, after] = m;
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

function Shell({ view }: { view: ViewId }) {
  const shell = useSidecarShell(useFeatureToggle("web.sidecar", false));
  return h("div", null,
    h(TopNav, { view, validViews: VALID, onNavigate: vi.fn(), onOpenSearch: vi.fn(), sidecar: shell.button }),
    h(SidecarDock, { open: shell.drawer.open, sidecar: shell.sidecar, onClose: shell.drawer.close },
      h("div", { class: "app-body" }, h("main", { id: "main-content" }, "page")),
    ),
  );
}

let root: HTMLDivElement;

async function mount(view: ViewId = "analyze"): Promise<void> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(h(Shell, { view }), root); });
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
  server = { enabled: true, running: false, gate: null, sessions: [], frames: [], cards: [], requests: [] };
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

// ── Transcript ─────────────────────────────────────────────────────────────

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
    expect(options(".sidecar-vendor")).toEqual(["claude", "codex"]);
    expect(options(".sidecar-model")).toEqual(["gpt-5.5", "gpt-5.5-mini"]);
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

// ── Tool calls ─────────────────────────────────────────────────────────────

describe("tool calls", () => {
  const call = (seq: number, tool: string, input: Record<string, unknown>): SidecarFrame => ({
    seq, at: "t", type: "event", event: { type: "tool_use", toolCall: { tool, input } },
  });
  const result = (seq: number, tool: string, output: string): SidecarFrame => ({
    seq, at: "t", type: "event", event: { type: "tool_result", toolResult: { tool, output, durationMs: 5 } },
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
});

// ── Badge ──────────────────────────────────────────────────────────────────

describe("the waiting-card badge", () => {
  it("counts pending cards across this worktree's sessions and updates on sidecar:card", async () => {
    server.sessions = [
      { session: session({ id: "s1" }), running: true },
      { session: session({ id: "s2" }), running: true },
      { session: session({ id: "s3", endedAt: "x" }), running: false },
    ];
    server.cards = [
      { id: "c1", sessionId: "s1", status: "pending" },
      { id: "c2", sessionId: "s1", status: "approved" },
    ];
    await mount();
    expect(root.querySelector(".topnav-sidecar-badge")?.textContent).toBe("1");
    expect(button()?.getAttribute("aria-label")).toBe("Sidecar, 1 waiting");

    server.cards.push({ id: "c3", sessionId: "s2", status: "pending" });
    await announce({ type: "sidecar:card", sessionId: "s2", cardId: "c3", status: "pending", timestamp: "t" });
    expect(root.querySelector(".topnav-sidecar-badge")?.textContent).toBe("2");

    server.cards = server.cards.map((c) => ({ ...c, status: "approved" }));
    await announce({ type: "sidecar:card", sessionId: "s2", cardId: "c3", status: "approved", timestamp: "t" });
    expect(root.querySelector(".topnav-sidecar-badge")).toBeNull();
  });
});
