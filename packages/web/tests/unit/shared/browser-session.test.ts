// @vitest-environment jsdom
/**
 * The page half of the browser credential, evaluated as the served pages run
 * it: nonce exchange, sessionStorage, the fetch header, the sign-in notice,
 * and WebSocket tickets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_SESSION_SCRIPT, injectSessionScript } from "../../../src/shared/browser-session.js";

interface Call { url: string; headers: Headers; method: string }

type Reply = { status: number; body?: unknown };

let calls: Call[];
let replies: Record<string, Reply>;

function install(): void {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, location.href).pathname;
    calls.push({ url, headers: new Headers(init?.headers), method: (init?.method ?? "GET").toUpperCase() });
    const reply = replies[path] ?? { status: 200, body: {} };
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: reply.status === 401 ? { "WWW-Authenticate": 'Bearer realm="n-dx"' } : {},
    });
  }));
  delete (window as { ndxAuth?: unknown }).ndxAuth;
  // eslint-disable-next-line no-new-func
  new Function(BROWSER_SESSION_SCRIPT)();
}

const auth = () => (window as unknown as { ndxAuth: { ready: Promise<{ ok: boolean }>; socketUrl(u: string): Promise<string>; credential(): string | null } }).ndxAuth;

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = "<div id=app>app</div>";
  replies = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("BROWSER_SESSION_SCRIPT", () => {
  it("exchanges the landing nonce, keeps the credential in sessionStorage and drops the nonce from the address", async () => {
    history.replaceState(null, "", "/p/app/prd?view=tree&ndx_nonce=N1");
    replies["/api/auth/session"] = { status: 200, body: { credential: "S1" } };
    replies["/api/auth/state"] = { status: 200, body: { required: true, authenticated: true } };
    install();
    expect(await auth().ready).toEqual({ ok: true });

    expect(location.pathname + location.search).toBe("/p/app/prd?view=tree");
    expect(sessionStorage.getItem("ndx.session")).toBe("S1");
    const exchange = calls.find((c) => c.url === "/api/auth/session")!;
    expect(exchange.method).toBe("POST");
    expect(exchange.headers.get("x-ndx-nonce")).toBe("N1");

    // Every later same-origin request carries the credential; another origin's does not.
    await window.fetch("/api/status");
    await window.fetch("https://example.test/x");
    expect(calls.find((c) => c.url === "/api/status")!.headers.get("x-ndx-token")).toBe("S1");
    expect(calls.find((c) => c.url === "https://example.test/x")!.headers.get("x-ndx-token")).toBeNull();
  });

  it("shows the sign-in notice for a spent or expired link and does not report ready", async () => {
    history.replaceState(null, "", "/?ndx_nonce=OLD");
    replies["/api/auth/session"] = { status: 401 };
    replies["/api/auth/state"] = { status: 200, body: { required: true, authenticated: false } };
    install();
    expect(await auth().ready).toEqual({ ok: false });
    expect(document.body.textContent).toContain("expired or was already used");
    expect(document.body.textContent).toContain("ndx start");
  });

  it("shows the sign-in notice for a deep link opened without a credential", async () => {
    history.replaceState(null, "", "/prd/123");
    replies["/api/auth/state"] = { status: 200, body: { required: true, authenticated: false } };
    install();
    expect(await auth().ready).toEqual({ ok: false });
    expect(document.body.textContent).toContain("Sign-in needed");
  });

  it("reuses the tab's credential on reload, and needs none on an open server", async () => {
    sessionStorage.setItem("ndx.session", "KEPT");
    replies["/api/auth/state"] = { status: 200, body: { required: true, authenticated: true } };
    install();
    expect(await auth().ready).toEqual({ ok: true });
    expect(calls.find((c) => c.url === "/api/auth/state")!.headers.get("x-ndx-token")).toBe("KEPT");

    sessionStorage.clear();
    replies["/api/auth/state"] = { status: 200, body: { required: false, authenticated: true } };
    install();
    expect(await auth().ready).toEqual({ ok: true });
  });

  it("puts a fresh ticket on a WebSocket URL", async () => {
    sessionStorage.setItem("ndx.session", "S");
    replies["/api/auth/state"] = { status: 200, body: { required: true, authenticated: true } };
    replies["/api/auth/ws-ticket"] = { status: 200, body: { ticket: "T1" } };
    install();
    await auth().ready;
    const url = await auth().socketUrl("ws://localhost:3117/p/app/");
    expect(url).toBe("ws://localhost:3117/p/app/?ndx_ticket=T1");
    const ticketCall = calls.find((c) => c.url === "/api/auth/ws-ticket")!;
    expect(ticketCall.method).toBe("POST");
    expect(ticketCall.headers.get("x-ndx-token")).toBe("S");
  });

  it("ends the session on a 401 from the server and says so", async () => {
    sessionStorage.setItem("ndx.session", "S");
    replies["/api/auth/state"] = { status: 200, body: { required: true, authenticated: true } };
    install();
    await auth().ready;
    replies["/api/status"] = { status: 401 };
    await window.fetch("/api/status");
    expect(sessionStorage.getItem("ndx.session")).toBeNull();
    expect(document.body.textContent).toContain("session has ended");
  });
});

describe("injectSessionScript", () => {
  it("puts the script first in <head>", () => {
    const out = injectSessionScript('<!doctype html><html><head><title>x</title><script>page()</script></head><body></body></html>');
    expect(out.indexOf("ndxAuth")).toBeLessThan(out.indexOf("page()"));
    expect(out.indexOf("<head>")).toBeLessThan(out.indexOf("ndxAuth"));
  });
});
