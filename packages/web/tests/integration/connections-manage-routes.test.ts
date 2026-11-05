/**
 * Settings > Project > Connections' write routes behind the real request gate
 * and the `web.sidecar` route gate: add an HTTP and a stdio server through the
 * form's routes, Test them, store a token, remove, name a profile, set tracker
 * sync rules. Every write lands in `.n-dx.local.json`, never `.n-dx.json`; a
 * token lands in `connection:<id>` of a temp-home store and in no response,
 * project file or log.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storedCredential } from "@n-dx/llm-client";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { handleRequestSecurity, isPublicOnlyRequest, refusePublicOnly } from "../../src/server/request-security.js";
import { enforceRouteFeatureGate } from "../../src/server/route-feature-gates.js";
import { handleConnectionsRoute } from "../../src/server/routes-connections.js";
import type { ServerContext } from "../../src/server/types.js";
import { addCaosTools } from "../fixtures/connections/fake-mcp-tools.mjs";
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from "../helpers/fake-mcp-http-server.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";

const TOKEN = "dashboard-token-0123456789abcdef";
const SECRET = "tok-9f8e7d6c5b4a39281706";
const STDIO_SERVER = resolve(import.meta.dirname, "../fixtures/connections/fake-stdio-mcp-server.mjs");
const auth = { "X-Ndx-Token": TOKEN };

let root: string;
let ndxHome: string;
let server: RouteTestServer;
let fake: FakeMcpHttpServer;
let service: ConnectionService;

const localFile = () => join(root, ".n-dx.local.json");
const readLocal = () => JSON.parse(readFileSync(localFile(), "utf-8")) as Record<string, any>;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "connections-manage-"));
  ndxHome = mkdtempSync(join(tmpdir(), "connections-manage-home-"));
  fake = await startFakeMcpHttpServer({ extraTools: addCaosTools });
  // The tracked config stays exactly as it was: only the feature flag.
  writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar: true } } }));
  service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {} });
  const ctx: ServerContext = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  server = await startRouteTestServer(async (req, res) => {
    if (handleRequestSecurity(req, res, { token: TOKEN })) return true;
    if (isPublicOnlyRequest(req)) return refusePublicOnly(req, res);
    if (enforceRouteFeatureGate(req, res, ctx)) return true;
    return handleConnectionsRoute(req, res, ctx, { connectionsFor: () => service, credentials: { ndxHome } });
  });
});

afterEach(async () => {
  await service?.close();
  await server?.close();
  await fake.close();
  await removeTestDir(root);
  await removeTestDir(ndxHome);
});

function send(method: string, path: string, body?: unknown, headers: Record<string, string> = auth) {
  return fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const stdioForm = (id = "local") => ({ id, transport: "stdio", command: process.execPath, args: [STDIO_SERVER], env: { GREETING: "hi" } });
const httpForm = (id = "docs") => ({ id, transport: "http", url: fake.url, label: "Docs" });

describe("adding a connection", () => {
  it("writes an HTTP and a stdio server to .n-dx.local.json only, and answers each connected with its tools", async () => {
    const trackedBefore = readFileSync(join(root, ".n-dx.json"), "utf-8");

    const http = await send("POST", "/api/connections", httpForm());
    expect(http.status).toBe(201);
    expect((await http.json()).connection).toMatchObject({ id: "docs", label: "Docs", transport: "http", auth: "none", state: "connected" });

    const stdio = await send("POST", "/api/connections", stdioForm());
    expect(stdio.status).toBe(201);
    expect((await stdio.json()).connection).toMatchObject({ id: "local", transport: "stdio", state: "connected" });

    expect(readLocal().connections).toEqual({
      docs: { transport: "http", auth: "none", label: "Docs", url: new URL(fake.url).href },
      local: { transport: "stdio", auth: "none", command: process.execPath, args: [STDIO_SERVER], env: { GREETING: "hi" } },
    });
    expect(readFileSync(join(root, ".n-dx.json"), "utf-8")).toBe(trackedBefore);

    // Both are live in the shared service, the one the broker uses.
    expect(service.connectionIds()).toEqual(["docs", "local"]);
    expect((await service.listTools()).map((t) => t.displayName).sort()).toContain("local.read_item");
  });

  it("Test connects and lists each server's tools with class and policy, without saving anything", async () => {
    for (const form of [httpForm(), stdioForm()]) {
      const res = await send("POST", "/api/connections/test", form);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.state).toBe("connected");
      expect(body.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ tool: "read_item", class: "read", policy: "run", policySource: "default" }),
        expect.objectContaining({ tool: "update_item", class: "write", policy: "ask" }),
      ]));
    }
    expect(existsSync(localFile())).toBe(false);
    expect(service.connectionIds()).toEqual([]);
  });

  it("Test says why a server is unreachable instead of failing", async () => {
    const res = await send("POST", "/api/connections/test", { id: "gone", transport: "stdio", command: "/no/such/binary-xyz" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "unavailable", tools: [] });
  });

  it("refuses a bad form, a taken id and a reserved id, and writes nothing for them", async () => {
    await send("POST", "/api/connections", httpForm());
    const before = readFileSync(localFile(), "utf-8");
    const refused = async (body: unknown) => (await send("POST", "/api/connections", body)).status;
    expect(await refused(httpForm())).toBe(409);
    expect(await refused({ ...httpForm("sync") })).toBe(400);
    expect(await refused({ id: "Bad Id", transport: "http", url: fake.url })).toBe(400);
    expect(await refused({ id: "x", transport: "http", url: "ftp://nope" })).toBe(400);
    expect(await refused({ id: "x", transport: "http", url: "https://user:pw@example.com" })).toBe(400);
    expect(await refused({ id: "x", transport: "stdio" })).toBe(400);
    expect(await refused({ id: "x", transport: "stdio", command: "c", auth: "token" })).toBe(400);
    expect(await refused({ id: "x", transport: "stdio", command: "c", env: { A: 1 } })).toBe(400);
    expect(await refused({ id: "x", transport: "http", url: fake.url, token: SECRET })).toBe(400);
    expect(readFileSync(localFile(), "utf-8")).toBe(before);
  });

  it("refuses to write a local config file the repository commits, or one that does not parse", async () => {
    writeFileSync(localFile(), "{ not json");
    const broken = await send("POST", "/api/connections", httpForm());
    expect(broken.status).toBe(409);
    expect(readFileSync(localFile(), "utf-8")).toBe("{ not json");
  });

  it("needs the per-user token or a session on every route", async () => {
    for (const [method, path] of [
      ["POST", "/api/connections"], ["POST", "/api/connections/test"], ["DELETE", "/api/connections/docs"],
      ["PUT", "/api/connections/docs/token"], ["PUT", "/api/connections/docs/tools/read_item"],
      ["PUT", "/api/connections/docs/profile"], ["GET", "/api/connections/sync"], ["PUT", "/api/connections/sync"],
    ] as const) {
      expect((await send(method, path, method === "GET" ? undefined : {}, {})).status, `${method} ${path}`).toBe(401);
    }
    expect(existsSync(localFile())).toBe(false);
  });
});

describe("a token typed into the form", () => {
  const tokenForm = () => ({ id: "vault", transport: "http", url: fake.url, auth: "token", token: SECRET });

  /** Every file under the project, as one string. */
  function projectText(): string {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [readFileSync(join(dir, entry.name), "utf-8")]);
    return walk(root).join("\n");
  }

  it("lands in connection:<id> of the store, and in no response, project file or later listing", async () => {
    const responses: string[] = [];
    const add = await send("POST", "/api/connections", tokenForm());
    responses.push(await add.text());
    expect(add.status).toBe(201);
    expect(JSON.parse(responses[0]).connection).toMatchObject({ id: "vault", auth: "token", tokenStored: true });

    expect(storedCredential("connection:vault", { ndxHome })?.value).toBe(SECRET);
    // The server received it as the bearer, from the store.
    expect(fake.authorizations).toContain(`Bearer ${SECRET}`);

    for (const [method, path] of [["GET", "/api/connections"], ["GET", "/api/connections/vault/tools"], ["POST", "/api/connections/vault/test"]] as const) {
      responses.push(await (await send(method, path)).text());
    }
    // Replacing it, and the refusals around it.
    const replaced = await send("PUT", "/api/connections/vault/token", { token: `${SECRET}-2` });
    responses.push(await replaced.text());
    expect(replaced.status).toBe(200);
    expect(storedCredential("connection:vault", { ndxHome })?.value).toBe(`${SECRET}-2`);
    responses.push(await (await send("PUT", "/api/connections/vault/token", { token: `a\n${SECRET}` })).text());
    responses.push(await (await send("PUT", "/api/connections/vault/token", { token: 5 })).text());
    responses.push(await (await send("PUT", "/api/connections/vault/token", `{"token": "${SECRET}`)).text());

    for (const text of responses) expect(text).not.toContain(SECRET);
    expect(projectText()).not.toContain(SECRET);
    expect(readLocal().connections.vault).toEqual({ transport: "http", auth: "token", url: expect.any(String) });
  });

  it("is never sent by Test to the URL an unsaved form names", async () => {
    await send("POST", "/api/connections", tokenForm());
    const other = await startFakeMcpHttpServer();
    try {
      // The stored connection's id, another server: Test must not carry connection:vault there.
      for (const auth of ["token", "oauth"]) {
        const res = await send("POST", "/api/connections/test", { id: "vault", transport: "http", url: other.url, auth });
        expect(res.status, auth).toBe(400);
      }
      expect(other.authorizations.filter((header) => header?.includes(SECRET))).toEqual([]);
      expect(other.authorizations).toEqual([]);
    } finally {
      await other.close();
    }
  });

  it("is accepted only for a token connection", async () => {
    await send("POST", "/api/connections", httpForm());
    const res = await send("PUT", "/api/connections/docs/token", { token: SECRET });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(SECRET);
    expect(storedCredential("connection:docs", { ndxHome })).toBeUndefined();
  });

  it("adds a token connection with no token as 'sign in' until one is stored", async () => {
    const add = await send("POST", "/api/connections", { ...tokenForm(), token: undefined });
    expect((await add.json()).connection).toMatchObject({ state: "needs-sign-in", tokenStored: false });
    const stored = await send("PUT", "/api/connections/vault/token", { token: SECRET });
    expect((await stored.json()).connection).toMatchObject({ state: "connected", tokenStored: true });
  });

  it("is deleted with the connection only when the operator asks", async () => {
    await send("POST", "/api/connections", tokenForm());
    const kept = await send("DELETE", "/api/connections/vault");
    expect(await kept.json()).toEqual({ removed: "vault", credentialDeleted: false });
    expect(storedCredential("connection:vault", { ndxHome })?.value).toBe(SECRET);

    await send("POST", "/api/connections", tokenForm());
    const gone = await send("DELETE", "/api/connections/vault?credential=delete");
    expect(await gone.json()).toEqual({ removed: "vault", credentialDeleted: true });
    expect(storedCredential("connection:vault", { ndxHome })).toBeUndefined();
    expect(existsSync(localFile()) ? readLocal().connections : undefined).toBeUndefined();
    expect(service.connectionIds()).toEqual([]);
  });
});

describe("removing a connection", () => {
  it("drops its declaration and its place in the service, and keeps the others", async () => {
    await send("POST", "/api/connections", httpForm());
    await send("POST", "/api/connections", stdioForm());
    const res = await send("DELETE", "/api/connections/docs");
    expect(res.status).toBe(200);
    expect(Object.keys(readLocal().connections)).toEqual(["local"]);
    expect(service.connectionIds()).toEqual(["local"]);
    expect((await send("DELETE", "/api/connections/docs")).status).toBe(404);
  });
});

describe("a server profile", () => {
  it("is named through the picker, and the answer carries its validation against the server's tools", async () => {
    await send("POST", "/api/connections", httpForm());
    expect((await (await send("GET", "/api/connections/profiles")).json()).profiles).toContain("caos");

    const ok = await send("PUT", "/api/connections/docs/profile", { profile: "caos" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).connection.profile).toMatchObject({ name: "caos", state: "ok" });
    expect(readLocal().connections.docs.profile).toBe("caos");

    // A server whose tools the profile does not fit reads invalid, with the problem.
    const other = await startFakeMcpHttpServer();
    try {
      await send("POST", "/api/connections", { id: "plain", transport: "http", url: other.url });
      const bad = await send("PUT", "/api/connections/plain/profile", { profile: "caos" });
      const profile = (await bad.json()).connection.profile;
      expect(profile).toMatchObject({ name: "caos", state: "invalid" });
      expect(profile.problem).toEqual(expect.any(String));
    } finally {
      await other.close();
    }

    const cleared = await send("PUT", "/api/connections/docs/profile", { profile: null });
    expect((await cleared.json()).connection.profile).toBeUndefined();
    expect(readLocal().connections.docs).not.toHaveProperty("profile");
  });

  it("refuses an unknown profile and writes nothing", async () => {
    await send("POST", "/api/connections", httpForm());
    const before = readFileSync(localFile(), "utf-8");
    expect((await send("PUT", "/api/connections/docs/profile", { profile: "no-such-profile" })).status).toBe(400);
    expect((await send("PUT", "/api/connections/docs/profile", { profile: 3 })).status).toBe(400);
    expect(readFileSync(localFile(), "utf-8")).toBe(before);
  });
});

describe("tracker sync rules", () => {
  it("read all off with no block, and write trackerSync.rules to the local file, naming the connection the first time", async () => {
    await send("POST", "/api/connections", httpForm());
    const initial = await (await send("GET", "/api/connections/sync")).json();
    expect(initial.connection).toBeNull();
    expect(Object.values(initial.rules)).toEqual(Array(initial.events.length).fill("off"));
    expect(initial.connections).toEqual(["docs"]);

    // No connection named anywhere: refused, nothing written.
    expect((await send("PUT", "/api/connections/sync", { rules: { "pr-opened": "dry-run" } })).status).toBe(400);
    expect(readLocal().trackerSync).toBeUndefined();

    const set = await send("PUT", "/api/connections/sync", { connection: "docs", rules: { "pr-opened": "dry-run", "change-captured": "on" } });
    expect(set.status).toBe(200);
    expect((await set.json()).rules).toMatchObject({ "pr-opened": "dry-run", "change-captured": "on", "run-started": "off" });
    expect(readLocal().trackerSync).toEqual({ connection: "docs", rules: { "pr-opened": "dry-run", "change-captured": "on" } });

    // Later writes change only the events they name and keep the rest of the block.
    writeFileSync(localFile(), JSON.stringify({ ...readLocal(), trackerSync: { ...readLocal().trackerSync, featureMap: { r1: "f1" } } }));
    await send("PUT", "/api/connections/sync", { rules: { "pr-opened": "off" } });
    expect(readLocal().trackerSync).toEqual({
      connection: "docs",
      featureMap: { r1: "f1" },
      rules: { "pr-opened": "off", "change-captured": "on" },
    });
    expect(JSON.parse(readFileSync(join(root, ".n-dx.json"), "utf-8"))).toEqual({ features: { web: { sidecar: true } } });
  });

  it("refuse an unknown event, an unknown mode and an undeclared connection", async () => {
    await send("POST", "/api/connections", httpForm());
    const put = (body: unknown) => send("PUT", "/api/connections/sync", body).then((r) => r.status);
    expect(await put({ connection: "docs", rules: { "pr-closed": "on" } })).toBe(400);
    expect(await put({ connection: "docs", rules: { "pr-opened": "always" } })).toBe(400);
    expect(await put({ connection: "ghost", rules: { "pr-opened": "on" } })).toBe(400);
    expect(await put({ connection: "docs" })).toBe(400);
    expect(readLocal().trackerSync).toBeUndefined();
  });
});
