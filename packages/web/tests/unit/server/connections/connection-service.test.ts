import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { credentialFingerprint, setCredential } from "@n-dx/llm-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConnectionService,
  ConnectionUnavailableError,
  parseConnectionWireName,
  type ConnectionServiceOptions,
} from "../../../../src/server/connections/connection-service.js";
import { startFakeMcpHttpServer, startSilentHttpServer, type FakeMcpHttpServer } from "../../../helpers/fake-mcp-http-server.js";
import { removeTempDir } from "../../../helpers/temp-dir.js";

const STDIO_SERVER = resolve(import.meta.dirname, "../../../fixtures/connections/fake-stdio-mcp-server.mjs");
const SHARED_TOOLS = ["read_item", "delete_item", "update_item"];

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => removeTempDir(dir));
  return dir;
}

async function httpServer(): Promise<FakeMcpHttpServer> {
  const server = await startFakeMcpHttpServer();
  cleanups.push(() => server.close());
  return server;
}

/** A project whose .n-dx.local.json declares `connections`, and a service over it with a temp ndx home. */
function service(connections: Record<string, unknown>, options: Partial<ConnectionServiceOptions> = {}) {
  const projectDir = tempDir("ndx-connections-project-");
  const ndxHome = tempDir("ndx-connections-home-");
  writeFileSync(join(projectDir, ".n-dx.local.json"), JSON.stringify({ connections }));
  const warnings: string[] = [];
  const svc = new ConnectionService({
    projectDir,
    credentials: { ndxHome },
    warn: (message) => warnings.push(message),
    ...options,
  });
  cleanups.push(() => svc.close());
  return { svc, ndxHome, warnings };
}

const stdio = (env?: Record<string, string>) => ({
  transport: "stdio",
  command: process.execPath,
  args: [STDIO_SERVER],
  ...(env ? { env } : {}),
});

async function closedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((done) => probe.close(() => done()));
  return `http://127.0.0.1:${port}/mcp`;
}

function text(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join("");
}

describe("ConnectionService", () => {
  it("lists an http and a stdio server's tools as <id>.<tool>, wire name <id>__<tool>", async () => {
    const http = await httpServer();
    const { svc } = service({ docs: { transport: "http", url: http.url }, local: stdio() });

    const tools = await svc.listTools();
    const docs = tools.filter((t) => t.connection === "docs");
    expect(docs.map((t) => t.displayName).sort()).toEqual(SHARED_TOOLS.map((t) => `docs.${t}`).sort());
    const read = tools.find((t) => t.wireName === "local__read_item");
    expect(read).toMatchObject({
      connection: "local",
      tool: "read_item",
      displayName: "local.read_item",
      description: "Read an item by id.",
      annotations: { readOnlyHint: true },
    });
    expect(read?.inputSchema.properties).toHaveProperty("id");
    expect(tools.find((t) => t.wireName === "local__update_item")?.annotations).toBeUndefined();
    expect(parseConnectionWireName("local__read_item")).toEqual({ connection: "local", tool: "read_item" });

    expect((await svc.listConnections()).map((c) => [c.id, c.status.state])).toEqual([
      ["docs", "connected"],
      ["local", "connected"],
    ]);
    expect(text(await svc.callTool("docs", "read_item", { id: "7" }))).toBe("item 7");
    expect(text(await svc.callTool("local", "update_item", { id: "7", title: "t" }))).toBe("updated 7: t");
  });

  it("lists each tool's class and policy with their sources, honouring config overrides and warning on bad ones", async () => {
    const { svc, warnings } = service({
      local: {
        ...stdio(),
        tools: { read_item: { policy: "never" }, update_item: { class: "read" }, delete_item: { class: "nope" }, ghost: { policy: "run" } },
      },
    });
    const by = Object.fromEntries((await svc.listTools()).map((t) => [t.tool, t.policy]));
    expect(by.read_item).toEqual({ class: "read", classSource: "annotation", policy: "never", policySource: "override" });
    expect(by.update_item).toEqual({ class: "read", classSource: "override", policy: "run", policySource: "default" });
    expect(by.delete_item).toEqual({ class: "write", classSource: "annotation", policy: "ask", policySource: "default" });
    expect(warnings.filter((w) => w.includes('"ghost"'))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes('"delete_item"'))).toHaveLength(1);
  });

  it("warns about the same bad override once per connection, naming each", async () => {
    const tools = { ghost: { policy: "run" } };
    const { svc, warnings } = service({ one: { ...stdio(), tools }, two: { ...stdio(), tools } });
    await svc.listTools();
    await svc.listTools();
    const ghost = warnings.filter((w) => w.includes('"ghost"'));
    expect(ghost).toHaveLength(2);
    expect(ghost.some((w) => w.includes("connection one"))).toBe(true);
    expect(ghost.some((w) => w.includes("connection two"))).toBe(true);
  });

  it("sends the stored connection:<id> token as a Bearer header", async () => {
    const http = await httpServer();
    http.requireToken = "tok-abc";
    const { svc, ndxHome } = service({ docs: { transport: "http", url: http.url, auth: "token" } });
    setCredential("connection:docs", "tok-abc", { ndxHome });

    expect(text(await svc.callTool("docs", "read_item", { id: "1" }))).toBe("item 1");
    expect(http.authorizations.length).toBeGreaterThan(0);
    expect(new Set(http.authorizations)).toEqual(new Set(["Bearer tok-abc"]));
  });

  it("reads needs-sign-in and sends nothing when no token is stored", async () => {
    const http = await httpServer();
    const { svc } = service({ docs: { transport: "http", url: http.url, auth: "token" } });

    const [docs] = await svc.listConnections();
    expect(docs.status).toMatchObject({ state: "needs-sign-in" });
    expect(await svc.listTools()).toEqual([]);
    await expect(svc.callTool("docs", "read_item", { id: "1" })).rejects.toThrow(/needs sign-in/);
    expect(http.authorizations).toEqual([]);
  });

  it("reads needs-sign-in when the server refuses the stored token", async () => {
    const http = await httpServer();
    http.requireToken = "the-right-one";
    const { svc, ndxHome } = service({ docs: { transport: "http", url: http.url, auth: "token" } });
    setCredential("connection:docs", "a-wrong-one", { ndxHome });

    const [docs] = await svc.listConnections();
    expect(docs.status).toEqual({ state: "needs-sign-in", reason: "the server refused the stored token" });
  });

  it("reads needs-sign-in, not a refused token, when an auth-none server answers 401", async () => {
    const http = await httpServer();
    http.requireToken = "anything";
    const { svc } = service({ docs: { transport: "http", url: http.url } });
    const [docs] = await svc.listConnections();
    expect(docs.status.state).toBe("needs-sign-in");
    expect(docs.status).not.toMatchObject({ reason: expect.stringContaining("stored token") });
  });

  it("keeps the stored token out of a connect failure's reason but names the HTTP status", async () => {
    const http = await httpServer();
    http.echoErrors = "all";
    const { svc, ndxHome } = service({ docs: { transport: "http", url: http.url, auth: "token" } });
    setCredential("connection:docs", "tok-echoed-secret-1234", { ndxHome });

    const [docs] = await svc.listConnections();
    expect(docs.status.state).toBe("unavailable");
    const reason = (docs.status as { reason: string }).reason;
    expect(http.authorizations).toContain("Bearer tok-echoed-secret-1234");
    expect(reason).not.toContain("tok-echoed-secret-1234");
    expect(reason).toContain("HTTP 500");
    expect(reason).toContain(`[token ${credentialFingerprint("tok-echoed-secret-1234")}]`);
  });

  it("keeps the stored token out of a failed call's ConnectionUnavailableError", async () => {
    const http = await httpServer();
    http.echoErrors = "calls";
    const { svc, ndxHome } = service({ docs: { transport: "http", url: http.url, auth: "token" } });
    setCredential("connection:docs", "tok-echoed-secret-1234", { ndxHome });

    const failure = await svc.callTool("docs", "read_item", { id: "1" }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ConnectionUnavailableError);
    const message = (failure as Error).message;
    expect(message).not.toContain("tok-echoed-secret-1234");
    expect(message).toContain("HTTP 500");
    const [docs] = await svc.listConnections();
    expect(JSON.stringify(docs.status)).not.toContain("tok-echoed-secret-1234");
  });

  it("caps a long reason, keeping the HTTP status", async () => {
    const http = await httpServer();
    http.echoErrors = "all";
    // The server echoes the request URL, so a long query makes a long error body.
    const { svc } = service({ docs: { transport: "http", url: `${http.url}?pad=${"x".repeat(2_000)}` } });

    const [docs] = await svc.listConnections();
    const reason = (docs.status as { reason: string }).reason;
    expect(reason).toMatch(/^HTTP 500: /);
    expect(reason).toHaveLength(301);
    expect(reason.endsWith("…")).toBe(true);
  });

  it("reads needs-sign-in for an oauth connection until the sign-in lands", async () => {
    const http = await httpServer();
    const { svc } = service({ docs: { transport: "http", url: http.url, auth: "oauth" } });
    const [docs] = await svc.listConnections();
    expect(docs.status.state).toBe("needs-sign-in");
    expect(http.authorizations).toEqual([]);
  });

  it("gives a stdio server the sanitized environment plus only its literal env", async () => {
    const secretName = "NDX_TEST_FAKE_SERVICE_SECRET";
    process.env[secretName] = "do-not-pass";
    cleanups.push(() => {
      delete process.env[secretName];
    });
    const { svc, ndxHome } = service({ local: stdio({ MODE: "literal" }) });
    setCredential("connection:local", "stored-connection-token", { ndxHome });

    const env = JSON.parse(text(await svc.callTool("local", "show_env", {}))) as Record<string, string>;
    expect(env.MODE).toBe("literal");
    expect(env).not.toHaveProperty(secretName);
    expect(JSON.stringify(env)).not.toContain("do-not-pass");
    expect(JSON.stringify(env)).not.toContain("stored-connection-token");
  });

  it("reads 'connection unavailable' for a refused, a timed-out and an exited server; others keep working", async () => {
    const http = await httpServer();
    const silent = await startSilentHttpServer();
    cleanups.push(() => silent.close());
    const { svc } = service(
      {
        refused: { transport: "http", url: await closedPortUrl() },
        silent: { transport: "http", url: silent.url },
        local: stdio(),
        docs: { transport: "http", url: http.url },
      },
      // Long enough for the stdio fake to start under a loaded runner.
      { connectTimeoutMs: 5_000 },
    );

    const states = Object.fromEntries((await svc.listConnections()).map((c) => [c.id, c.status]));
    expect(states.refused.state).toBe("unavailable");
    expect(states.silent).toMatchObject({ state: "unavailable", reason: expect.stringMatching(/timed out/i) });
    expect(states.local.state).toBe("connected");
    await expect(svc.callTool("refused", "read_item", { id: "1" })).rejects.toBeInstanceOf(ConnectionUnavailableError);
    await expect(svc.callTool("refused", "read_item", { id: "1" })).rejects.toThrow(/^connection unavailable/);

    // The stdio server dies mid-call: that call fails, the connection reads
    // unavailable, the others keep working, and the next call reconnects.
    await expect(svc.callTool("local", "exit_now", {})).rejects.toThrow(/^connection unavailable: local/);
    const local = (await svc.listConnections()).find((c) => c.id === "local");
    expect(local?.status.state).toBe("connected");
    expect(text(await svc.callTool("docs", "read_item", { id: "2" }))).toBe("item 2");
    expect(text(await svc.callTool("local", "read_item", { id: "3" }))).toBe("item 3");
  });

  it("reconnects on next use after a failure", async () => {
    const { svc } = service({ local: stdio() });
    await expect(svc.callTool("local", "exit_now", {})).rejects.toBeInstanceOf(ConnectionUnavailableError);
    expect(text(await svc.callTool("local", "read_item", { id: "9" }))).toBe("item 9");
  });

  it("refreshes the cached tool list on notifications/tools/list_changed", async () => {
    const { svc } = service({ local: stdio() });
    expect((await svc.listTools()).some((t) => t.tool === "fresh_tool")).toBe(false);
    await svc.callTool("local", "add_tool", { name: "fresh_tool" });
    await expect.poll(async () => (await svc.listTools()).some((t) => t.wireName === "local__fresh_tool")).toBe(true);
  });

  it("skips a tool whose wire name is over 64 characters, naming it", async () => {
    const { svc, warnings } = service({ local: stdio() });
    const long = "t".repeat(60);
    await svc.callTool("local", "add_tool", { name: long });
    await expect.poll(async () => warnings.some((w) => w.includes(`local__${long}`))).toBe(true);
    expect((await svc.listTools()).some((t) => t.tool === long)).toBe(false);
  });
});
