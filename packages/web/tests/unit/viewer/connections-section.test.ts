// @vitest-environment jsdom
/**
 * Settings > Project > Connections: shown only while web.sidecar is on; each
 * connection's state ('connected', 'connection unavailable: …', 'sign in
 * again'), Sign in / Sign out for OAuth connections; and the sign-in's return,
 * whose code and state leave the address bar before they are posted to the
 * finish route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ProjectView } from "../../../src/viewer/views/project.js";
import { captureSignInReturn, ConnectionsSection, type ConnectionRow } from "../../../src/viewer/views/connections.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

type Json = Record<string, unknown>;
interface Request { method: string; url: string; body: Json | null }

const DOCS: ConnectionRow = { id: "docs", label: "Docs", transport: "http", auth: "oauth", state: "connected", tools: 3 };
const WIKI: ConnectionRow = {
  id: "wiki", label: "Wiki", transport: "http", auth: "oauth", state: "needs-sign-in",
  reason: "the sign-in expired or was revoked; sign in again", tools: 2,
};
const LOCAL: ConnectionRow = { id: "local", label: "Local", transport: "stdio", auth: "none", state: "unavailable", reason: "the server closed the connection", tools: 0 };

function stubApi(opts: { sidecar?: boolean; connections?: ConnectionRow[] } = {}) {
  const requests: Request[] = [];
  const connections = opts.connections ?? [DOCS, WIKI, LOCAL];
  const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) as Json : null;
    requests.push({ method, url, body });
    if (method === "GET" && url === "/api/features") {
      return respond({ toggles: [{ key: "web.sidecar", label: "Sidecar", enabled: opts.sidecar ?? true, defaultValue: false, description: "", impact: "", package: "hench", stability: "experimental" }] });
    }
    if (method === "GET" && url === "/api/project-settings") return respond({ port: null, language: null, sourcevisionMergeThreshold: null, sourcevisionPins: {} });
    if (method === "GET" && url === "/api/connections") return respond({ connections, configFile: ".n-dx.local.json" });
    const action = /^\/api\/connections\/([^/]+)\/(.+)$/.exec(url);
    if (method === "POST" && action) {
      const [, id, what] = action;
      const row = connections.find((c) => c.id === id)!;
      if (what === "oauth/start") return respond({ authorizationUrl: `https://auth.example/authorize?for=${id}` });
      if (what === "oauth/finish") return respond({ connection: { ...row, state: "connected", reason: undefined } });
      if (what === "sign-out") return respond({ connection: { ...row, state: "needs-sign-in", reason: "signed out" } });
    }
    return respond({});
  }));
  return requests;
}

async function settle() {
  for (let round = 0; round < 4; round++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

describe("Connections section", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    setBasePathForTests(null);
    history.replaceState(null, "", "/project");
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
    setBasePathForTests(null);
  });

  const row = (id: string) => root.querySelector(`[data-connection="${id}"]`);
  const state = (id: string) => row(id)?.querySelector(".connections-state")?.textContent;
  const buttons = (id: string) => [...(row(id)?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
  const titles = () => [...root.querySelectorAll(".project-section-title")].map((t) => t.textContent);

  it("appears on Settings > Project only while web.sidecar is on", async () => {
    const off = stubApi({ sidecar: false });
    act(() => { render(h(ProjectView, null), root); });
    await settle();
    expect(titles()).not.toContain("Connections");
    expect(off.some((r) => r.url === "/api/connections")).toBe(false);

    act(() => { render(null, root); });
    stubApi({ sidecar: true });
    act(() => { render(h(ProjectView, null), root); });
    await settle();
    expect(titles()).toContain("Connections");
    expect(root.textContent).toContain(".n-dx.local.json");
    // Read-only: it never makes the page dirty.
    expect(root.querySelector(".settings-frame-indicator")!.textContent).toBe("All changes saved");
  });

  it("shows each state, with Sign in / Sign out for OAuth connections only", async () => {
    stubApi();
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    expect(state("docs")).toBe("connected");
    expect(buttons("docs")).toEqual(["Sign out"]);
    expect(state("wiki")).toBe("sign in again");
    expect(buttons("wiki")).toEqual(["Sign in"]);
    expect(state("local")).toBe("connection unavailable: the server closed the connection");
    expect(buttons("local")).toEqual([]);
  });

  it("reads 'sign in' for a connection that never signed in and 'sign in again' for one whose token was refused", async () => {
    const never: ConnectionRow = { ...WIKI, id: "fresh", reason: "not signed in yet; sign in from the dashboard" };
    const refused: ConnectionRow = { ...WIKI, id: "lost", reason: "the server refused the signed-in token; the sign-in expired or was revoked; sign in again" };
    stubApi({ connections: [never, refused] });
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    expect(state("fresh")).toBe("sign in");
    expect(state("lost")).toBe("sign in again");
  });

  it("Sign in asks for an authorization URL that returns to this dashboard's Project page", async () => {
    setBasePathForTests("/p/alpha");
    const requests = stubApi();
    const went: string[] = [];
    act(() => { render(h(ConnectionsSection, { navigate: (url) => went.push(url) }), root); });
    await settle();
    await act(async () => { (row("wiki")!.querySelector("button") as HTMLButtonElement).click(); });
    await settle();
    const start = requests.find((r) => r.url === "/api/connections/wiki/oauth/start")!;
    expect(start.method).toBe("POST");
    expect(start.body).toEqual({ redirectUrl: `${location.origin}/p/alpha/project?connection=wiki` });
    expect(went).toEqual(["https://auth.example/authorize?for=wiki"]);
  });

  it("Sign out updates the row", async () => {
    const requests = stubApi();
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    await act(async () => { (row("docs")!.querySelector("button") as HTMLButtonElement).click(); });
    await settle();
    expect(requests.some((r) => r.method === "POST" && r.url === "/api/connections/docs/sign-out")).toBe(true);
    expect(state("docs")).toBe("sign in");
    expect(buttons("docs")).toEqual(["Sign in"]);
  });

  it("finishes a returned sign-in, clearing code and state from the address bar before posting them", async () => {
    history.replaceState(null, "", "/project?connection=wiki&code=the-code&state=the-state&tab=x");
    const requests = stubApi();
    let urlAtFinish = "";
    const inner = globalThis.fetch as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/oauth/finish")) urlAtFinish = location.href;
      return inner(url, init);
    });
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    const finish = requests.find((r) => r.url === "/api/connections/wiki/oauth/finish")!;
    expect(finish.body).toEqual({ code: "the-code", state: "the-state" });
    expect(urlAtFinish).not.toContain("the-code");
    expect(location.search).toBe("?tab=x");
    expect(location.pathname).toBe("/project");
    expect(root.querySelector(".connections-notice--ok")?.textContent).toContain("Signed in to Wiki");
  });

  it("finishes a sign-in captured at boot after the router has rewritten the address to the bare view path", async () => {
    history.replaceState(null, "", "/project?connection=wiki&code=boot-code&state=boot-state");
    captureSignInReturn();
    expect(location.search).toBe("");
    // As use-route-state seeds its first entry: the view's path, no query.
    history.replaceState({ view: "project" }, "", "/project");
    const requests = stubApi();
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    const finish = requests.find((r) => r.url === "/api/connections/wiki/oauth/finish");
    expect(finish?.body).toEqual({ code: "boot-code", state: "boot-state" });

    // Used once: a later mount finishes nothing.
    act(() => { render(null, root); });
    const again = stubApi();
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    expect(again.some((r) => r.method === "POST")).toBe(false);
  });

  it("reports an authorization server's refusal without posting anything", async () => {
    history.replaceState(null, "", "/project?connection=wiki&error=access_denied&state=s");
    const requests = stubApi();
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    expect(location.search).toBe("");
    expect(root.querySelector(".connections-notice--error")?.textContent).toContain("access_denied");
  });
});
