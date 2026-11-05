// @vitest-environment jsdom
/**
 * Settings > Project > Connections: shown only while web.sidecar is on; each
 * connection's state ('connected', 'connection unavailable: …', 'sign in
 * again'), Sign in / Sign out for OAuth connections; and the sign-in's return
 * to the fixed callback page, whose code, state and iss leave the address bar
 * before they are posted to the finish route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ProjectView } from "../../../src/viewer/views/project.js";
import { captureSignInReturn, ConnectionsSection, type ConnectionRow } from "../../../src/viewer/views/connections.js";
import type { ToolRow } from "../../../src/viewer/views/connections-api.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { formatSignInState } from "../../../src/shared/index.js";

const NONCE = "n".repeat(43);

type Json = Record<string, unknown>;
interface Request { method: string; url: string; body: Json | null }

const DOCS: ConnectionRow = { id: "docs", label: "Docs", transport: "http", auth: "oauth", state: "connected", tools: 3 };
const WIKI: ConnectionRow = {
  id: "wiki", label: "Wiki", transport: "http", auth: "oauth", state: "needs-sign-in",
  reason: "the sign-in expired or was revoked; sign in again", signIn: "again", tools: 2,
};
const LOCAL: ConnectionRow = { id: "local", label: "Local", transport: "stdio", auth: "none", state: "unavailable", reason: "the server closed the connection", tools: 0 };

const EVENTS = ["change-captured", "run-started", "pr-opened", "pr-merged", "release-published", "run-failed-twice"];
const TOOLS: ToolRow[] = [
  { tool: "read_item", description: "Read an item.", class: "read", classSource: "annotation", policy: "run", policySource: "default" },
  { tool: "update_item", description: "Update an item.", class: "write", classSource: "default", policy: "ask", policySource: "default" },
];

function stubApi(opts: { sidecar?: boolean; connections?: ConnectionRow[]; profileState?: ConnectionRow["profile"] } = {}) {
  const requests: Request[] = [];
  const connections = opts.connections ?? [DOCS, WIKI, LOCAL];
  const tools = TOOLS.map((t) => ({ ...t }));
  const sync = { connection: null as string | null, rules: Object.fromEntries(EVENTS.map((e) => [e, "off"])) as Record<string, string> };
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
    if (method === "GET" && url === "/api/connections/profiles") return respond({ profiles: ["caos"] });
    if (url === "/api/connections/sync") {
      if (method === "PUT") {
        Object.assign(sync.rules, (body!.rules as Record<string, string>));
        if (typeof body!.connection === "string") sync.connection = body!.connection;
      }
      return respond({ ...sync, events: EVENTS, connections: connections.map((c) => c.id) });
    }
    if (method === "POST" && url === "/api/connections/test") {
      return respond({ state: "connected", tools: TOOLS });
    }
    if (method === "POST" && url === "/api/connections") {
      const added: ConnectionRow = { id: String(body!.id), label: String(body!.label ?? body!.id), transport: body!.transport as "http" | "stdio", auth: (body!.auth as ConnectionRow["auth"]) ?? "none", state: "connected", tools: 2, ...(body!.auth === "token" && { tokenStored: "token" in body! }) };
      connections.push(added);
      return respond({ connection: added }, 201);
    }
    const tool = /^\/api\/connections\/([^/]+)\/tools\/([^/]+)$/.exec(url);
    if (method === "PUT" && tool) {
      const patch = body as { class?: string | null; policy?: string | null };
      const index = tools.findIndex((t) => t.tool === tool[2]);
      const base = TOOLS[index];
      const current = tools[index];
      tools[index] = {
        ...current,
        class: patch.class === null ? base.class : (patch.class as ToolRow["class"] | undefined) ?? current.class,
        classSource: patch.class === null ? base.classSource : patch.class ? "override" : current.classSource,
        policy: patch.policy === null ? base.policy : (patch.policy as ToolRow["policy"] | undefined) ?? current.policy,
        policySource: patch.policy === null ? base.policySource : patch.policy ? "override" : current.policySource,
      };
      return respond({ tool: tools[index] });
    }
    const manage = /^\/api\/connections\/([^/?]+)(?:\/(tools|test|profile|token))?(?:\?.*)?$/.exec(url);
    if (manage) {
      const row = connections.find((c) => c.id === manage[1])!;
      if (method === "DELETE") {
        connections.splice(connections.indexOf(row), 1);
        return respond({ removed: row.id, credentialDeleted: url.includes("credential=delete") });
      }
      if (manage[2] === "tools" && method === "GET") return respond({ connection: row, tools });
      if (manage[2] === "test") return respond({ connection: { ...row, state: "connected", tools: TOOLS.length }, tools: TOOLS });
      if (manage[2] === "profile") {
        const profile = body!.profile === null ? undefined : { name: String(body!.profile), ...(opts.profileState ?? { state: "ok" }) };
        return respond({ connection: { ...row, profile } });
      }
      if (manage[2] === "token") {
        row.tokenStored = true;
        return respond({ connection: { ...row, state: "connected" } });
      }
    }
    const action = /^\/api\/connections\/([^/]+)\/(.+)$/.exec(url);
    if (method === "POST" && action) {
      const [, id, what] = action;
      const row = connections.find((c) => c.id === id)!;
      if (what === "oauth/start") return respond({ authorizationUrl: `https://auth.example/authorize?for=${id}` });
      if (what === "oauth/finish") return respond({ connection: { ...row, state: "connected", reason: undefined } });
      if (what === "sign-out") return respond({ connection: { ...row, state: "needs-sign-in", reason: "signed out", signIn: "first" } });
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
    expect(buttons("docs")).toEqual(["Sign out", "Test", "Details", "Remove"]);
    expect(state("wiki")).toBe("sign in again");
    expect(buttons("wiki")).toEqual(["Sign in", "Test", "Details", "Remove"]);
    expect(state("local")).toBe("connection unavailable: the server closed the connection");
    expect(buttons("local")).toEqual(["Test", "Details", "Remove"]);
  });

  it("reads 'sign in' for a connection that never signed in and 'sign in again' for one whose token was refused", async () => {
    const never: ConnectionRow = { ...WIKI, id: "fresh", reason: "not signed in yet; sign in from the dashboard", signIn: "first" };
    const refused: ConnectionRow = { ...WIKI, id: "lost", reason: "the sign-in expired or was revoked; sign in again", signIn: "again" };
    // A token-auth connection's refused token carries no "sign in again" text; the field decides.
    const token: ConnectionRow = { ...WIKI, id: "tok", auth: "token", reason: "the server refused the stored token", signIn: "again" };
    stubApi({ connections: [never, refused, token] });
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    expect(state("fresh")).toBe("sign in");
    expect(state("lost")).toBe("sign in again");
    expect(state("tok")).toBe("sign in again");
  });

  it("Sign in asks for an authorization URL that returns to the fixed callback, naming where this dashboard is mounted", async () => {
    setBasePathForTests("/p/alpha/w/feature");
    const requests = stubApi();
    const went: string[] = [];
    act(() => { render(h(ConnectionsSection, { navigate: (url) => went.push(url) }), root); });
    await settle();
    await act(async () => { (row("wiki")!.querySelector("button") as HTMLButtonElement).click(); });
    await settle();
    const start = requests.find((r) => r.url === "/api/connections/wiki/oauth/start")!;
    expect(start.method).toBe("POST");
    expect(start.body).toEqual({ redirectUrl: `${location.origin}/oauth/callback`, basePath: "/p/alpha/w/feature" });
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
    expect(buttons("docs")).toEqual(["Sign in", "Test", "Details", "Remove"]);
  });

  it("finishes a sign-in returned to the callback page: code, state and iss posted, the address on Settings > Project first", async () => {
    setBasePathForTests(null);
    const state = formatSignInState({ project: "alpha", connection: "wiki", nonce: NONCE });
    history.replaceState(null, "", `/p/alpha/oauth/callback?${new URLSearchParams({ code: "the-code", state, iss: "https://as.example" })}`);
    const replaced: string[] = [];
    captureSignInReturn((url) => replaced.push(url));
    expect(replaced).toEqual([]);
    expect(location.pathname).toBe("/p/alpha/project");
    expect(location.search).toBe("");

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
    expect(finish.body).toEqual({ code: "the-code", state, iss: "https://as.example" });
    expect(urlAtFinish).not.toContain("the-code");
    expect(root.querySelector(".connections-notice--ok")?.textContent).toContain("Signed in to Wiki");

    // Used once: a later mount finishes nothing.
    act(() => { render(null, root); });
    const again = stubApi();
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    expect(again.some((r) => r.method === "POST")).toBe(false);
  });

  it("sends a return for another worktree to that worktree's callback page, query intact", async () => {
    setBasePathForTests(null);
    const state = formatSignInState({ project: "alpha", workspace: "feature", connection: "wiki", nonce: NONCE });
    const search = `?${new URLSearchParams({ code: "c", state })}`;
    history.replaceState(null, "", `/p/alpha/oauth/callback${search}`);
    const replaced: string[] = [];
    captureSignInReturn((url) => replaced.push(url));
    expect(replaced).toEqual([`/p/alpha/w/feature/oauth/callback${search}`]);
  });

  it("leaves an ordinary page load alone", async () => {
    history.replaceState(null, "", "/project?code=x&state=y");
    const replaced: string[] = [];
    captureSignInReturn((url) => replaced.push(url));
    expect(replaced).toEqual([]);
    expect(location.search).toBe("?code=x&state=y");
  });

  it("reports an authorization server's refusal, or a return this dashboard did not start, without posting anything", async () => {
    setBasePathForTests(null);
    const state = formatSignInState({ connection: "wiki", nonce: NONCE });
    history.replaceState(null, "", `/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    captureSignInReturn(() => undefined);
    const requests = stubApi();
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    expect(location.pathname).toBe("/project");
    expect(root.querySelector(".connections-notice--error")?.textContent).toContain("access_denied");

    act(() => { render(null, root); });
    setBasePathForTests(null);
    history.replaceState(null, "", "/oauth/callback?code=c&state=garbled");
    captureSignInReturn(() => undefined);
    const garbled = stubApi();
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    expect(garbled.some((r) => r.method === "POST")).toBe(false);
    expect(root.querySelector(".connections-notice--error")?.textContent).toContain("does not name a sign-in started here");
  });
});

describe("Connections section: managing", () => {
  let root: HTMLDivElement;
  const VAULT: ConnectionRow = { id: "vault", label: "Vault", transport: "http", auth: "token", state: "connected", tools: 2, tokenStored: false };
  const SECRET = "tok-viewer-9f8e7d6c5b4a";

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

  async function mount(opts: Parameters<typeof stubApi>[0] = {}) {
    const requests = stubApi({ connections: [{ ...DOCS, auth: "none" }, { ...VAULT }], ...opts });
    act(() => { render(h(ConnectionsSection, null), root); });
    await settle();
    return requests;
  }

  const row = (id: string) => root.querySelector(`[data-connection="${id}"]`) as HTMLElement;
  const button = (scope: ParentNode, text: string) =>
    [...scope.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
  const input = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T;
  const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await settle(); };
  const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const choose = async (el: HTMLSelectElement, value: string) => {
    await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
  };
  const form = () => root.querySelector("form[aria-label='Add connection']") as HTMLElement;
  const sent = (requests: Request[], method: string, url: string) => requests.filter((r) => r.method === method && r.url === url);

  it("adds an HTTP server from the form and shows it", async () => {
    const requests = await mount();
    await click(button(root, "Add connection"));
    await type(input("#connection-add-id"), "wiki2");
    await type(input("#connection-add-url"), "https://wiki.example/mcp");
    await click(button(root, "Add"));

    expect(sent(requests, "POST", "/api/connections").map((r) => r.body)).toEqual([
      { id: "wiki2", transport: "http", url: "https://wiki.example/mcp", auth: "none" },
    ]);
    expect(row("wiki2")).not.toBeNull();
    expect(root.querySelector(".connections-notice--ok")?.textContent).toContain("Added wiki2");
    // The form closes and is empty the next time.
    expect(root.querySelector("form[aria-label='Add connection']")).toBeNull();
  });

  it("tests a stdio server as described, listing its tools, and saves nothing", async () => {
    const requests = await mount();
    await click(button(root, "Add connection"));
    await click(root.querySelector("input[name='connection-transport']:not(:checked)") as HTMLElement);
    await type(input("#connection-add-id"), "local2");
    await type(input("#connection-add-command"), "node");
    await type(input("#connection-add-args"), "server.js\n--flag");
    await type(input("#connection-add-env"), "GREETING=hi there\nA=b=c");
    await click(button(form(), "Test"));

    expect(sent(requests, "POST", "/api/connections/test").map((r) => r.body)).toEqual([
      { id: "local2", transport: "stdio", command: "node", args: ["server.js", "--flag"], env: { GREETING: "hi there", A: "b=c" }, auth: "none" },
    ]);
    expect(sent(requests, "POST", "/api/connections")).toEqual([]);
    expect([...root.querySelectorAll(".connections-test-result tbody tr")].map((r) => r.getAttribute("data-tool"))).toEqual(["read_item", "update_item"]);
    expect(root.querySelector(".connections-test-result")!.textContent).toContain("Connected: 2 tools.");
  });

  it("names what is wrong with a form before sending anything", async () => {
    const requests = await mount();
    await click(button(root, "Add connection"));
    await click(button(root, "Add"));
    expect(root.querySelector("form [role='alert']")?.textContent).toContain("Give the connection an id");
    await type(input("#connection-add-id"), "x");
    await click(root.querySelector("input[name='connection-transport']:not(:checked)") as HTMLElement);
    await type(input("#connection-add-command"), "node");
    await type(input("#connection-add-env"), "NOEQUALS");
    await click(button(root, "Add"));
    expect(root.querySelector("form [role='alert']")?.textContent).toContain("NAME=value");
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("sends a typed token once, empties the field, and never shows it again", async () => {
    const requests = await mount();
    await click(button(root, "Add connection"));
    await type(input("#connection-add-id"), "vault2");
    await type(input("#connection-add-url"), "https://v.example/mcp");
    await choose(input("#connection-add-auth"), "token");
    // A token connection is tested once added: its credential is not stored yet.
    expect(button(form(), "Test").disabled).toBe(true);
    await type(input("#connection-add-token"), SECRET);
    await click(button(root, "Add"));

    expect(sent(requests, "POST", "/api/connections")[0].body).toMatchObject({ id: "vault2", auth: "token", token: SECRET });
    expect(root.innerHTML).not.toContain(SECRET);

    // The details field of a stored connection: sent on Save, cleared at once.
    await click(button(row("vault"), "Details"));
    const field = input<HTMLInputElement>("#connection-token-vault");
    expect(field.type).toBe("password");
    await type(field, SECRET);
    await click(button(row("vault"), "Save token"));
    expect(sent(requests, "PUT", "/api/connections/vault/token").map((r) => r.body)).toEqual([{ token: SECRET }]);
    expect(input<HTMLInputElement>("#connection-token-vault").value).toBe("");
    expect(root.innerHTML).not.toContain(SECRET);
    expect(row("vault").textContent).toContain("A token is stored.");
  });

  it("lists a connection's tools and saves a changed class or policy, and a reset", async () => {
    const requests = await mount();
    await click(button(row("docs"), "Details"));
    expect([...row("docs").querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-tool"))).toEqual(["read_item", "update_item"]);

    const policy = row("docs").querySelector("select[aria-label='Policy of update_item']") as HTMLSelectElement;
    expect(policy.value).toBe("ask");
    await choose(policy, "never");
    const klass = row("docs").querySelector("select[aria-label='Class of update_item']") as HTMLSelectElement;
    await choose(klass, "read");
    expect(sent(requests, "PUT", "/api/connections/docs/tools/update_item").map((r) => r.body)).toEqual([{ policy: "never" }, { class: "read" }]);
    expect((row("docs").querySelector("select[aria-label='Policy of update_item']") as HTMLSelectElement).value).toBe("never");

    await click(button(row("docs"), "Reset"));
    expect(sent(requests, "PUT", "/api/connections/docs/tools/update_item").at(-1)!.body).toEqual({ class: null, policy: null });
  });

  it("names a server profile and shows its validation result, fitting or not", async () => {
    let requests = await mount();
    await click(button(row("docs"), "Details"));
    const picker = input<HTMLSelectElement>("#connection-profile-docs");
    expect([...picker.options].map((o) => o.value)).toEqual(["", "caos"]);
    await choose(picker, "caos");
    expect(sent(requests, "PUT", "/api/connections/docs/profile").map((r) => r.body)).toEqual([{ profile: "caos" }]);
    expect(row("docs").querySelector(".connections-profile")!.textContent).toBe("Profile caos fits this server.");

    act(() => { render(null, root); });
    vi.unstubAllGlobals();
    requests = await mount({ profileState: { name: "caos", state: "invalid", problem: "it has no tool create_page" } });
    await click(button(row("docs"), "Details"));
    await choose(input<HTMLSelectElement>("#connection-profile-docs"), "caos");
    expect(row("docs").querySelector(".connections-profile--invalid")!.textContent)
      .toBe("Profile caos does not fit this server: it has no tool create_page. It is not used.");
  });

  it("writes a rule's mode when its toggle changes, naming the connection the first time, and puts active rules on dry-run", async () => {
    const requests = await mount();
    const rule = (event: string) => root.querySelector(`[data-event='${event}'] select`) as HTMLSelectElement;
    expect([...root.querySelectorAll(".connections-rule select")].map((s) => (s as HTMLSelectElement).value)).toEqual(Array(6).fill("off"));
    expect(button(root, "Switch all to dry-run").disabled).toBe(true);

    await choose(rule("pr-opened"), "dry-run");
    await choose(rule("change-captured"), "on");
    expect(sent(requests, "PUT", "/api/connections/sync").map((r) => r.body)).toEqual([
      { rules: { "pr-opened": "dry-run" }, connection: "docs" },
      { rules: { "change-captured": "on" }, connection: "docs" },
    ]);
    expect(rule("pr-opened").value).toBe("dry-run");
    expect(rule("change-captured").value).toBe("on");

    await click(button(root, "Switch all to dry-run"));
    expect(sent(requests, "PUT", "/api/connections/sync").at(-1)!.body).toMatchObject({ rules: { "change-captured": "dry-run" } });
    expect(rule("change-captured").value).toBe("dry-run");
    expect(button(root, "Switch all to dry-run").disabled).toBe(true);
  });

  it("Test reports the result of a fresh connect", async () => {
    const requests = await mount();
    await click(button(row("docs"), "Test"));
    expect(sent(requests, "POST", "/api/connections/docs/test")).toHaveLength(1);
    expect(root.querySelector(".connections-notice--ok")?.textContent).toBe("Docs is connected: 2 tools.");
  });

  it("asks before removing, and offers to delete the stored credential", async () => {
    const requests = await mount();
    await click(button(row("docs"), "Remove"));
    // A connection with no credential offers nothing to delete.
    expect(row("docs").querySelector("input[type='checkbox']")).toBeNull();
    await click(button(row("docs"), "Cancel"));
    expect(requests.filter((r) => r.method === "DELETE")).toEqual([]);

    await click(button(row("vault"), "Remove"));
    await click(row("vault").querySelector("input[type='checkbox']") as HTMLElement);
    expect(row("vault").textContent).toContain("connection:vault");
    await click(button(row("vault"), "Remove connection"));
    expect(sent(requests, "DELETE", "/api/connections/vault?credential=delete")).toHaveLength(1);
    expect(row("vault")).toBeNull();
    expect(root.querySelector(".connections-notice--ok")?.textContent).toBe("Removed Vault and its stored token.");
  });
});
