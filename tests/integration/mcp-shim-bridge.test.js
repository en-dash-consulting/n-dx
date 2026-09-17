/**
 * The MCP shim's bridge half, against a fake hub.
 *
 * An editor launches `ndx mcp rex .` once and speaks JSON-RPC over stdio to
 * whatever it gets. When a hub is running and the repository is registered,
 * that is this bridge: frames go out as HTTP POSTs carrying the worktree the
 * editor was opened in, and come back on stdout in the same newline-delimited
 * framing the editor expects.
 *
 * The hub here is a small HTTP server recording what it received, so the
 * assertions are about the wire — the headers, the framing, the session — not
 * about rex.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  bridgeStdio,
  findRegisteredProject,
  isNotification,
  parseTransportBody,
} from "../../packages/core/mcp-shim.js";

/** Collect everything written to a stream as decoded text. */
function collect(stream) {
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString("utf-8");
}

/** The JSON-RPC messages a bridge wrote, one per line. */
function framesFrom(text) {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("parseTransportBody", () => {
  it("reads a single JSON response", () => {
    expect(parseTransportBody("application/json", '{"jsonrpc":"2.0","id":1,"result":{}}'))
      .toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
  });

  it("reads every message in an SSE body, not just the last", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"p":1}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      "",
    ].join("\n");
    // A progress notification alongside the result is the client's to see.
    expect(parseTransportBody("text/event-stream", body)).toEqual([
      { jsonrpc: "2.0", method: "notifications/progress", params: { p: 1 } },
      { jsonrpc: "2.0", id: 7, result: { ok: true } },
    ]);
  });

  it("is empty for an empty body, and drops what it cannot parse", () => {
    expect(parseTransportBody("application/json", "")).toEqual([]);
    expect(parseTransportBody("application/json", "not json")).toEqual([]);
    expect(parseTransportBody("text/event-stream", "data: {oops\n")).toEqual([]);
  });
});

describe("isNotification", () => {
  it("is a message with no id — nothing is expected back", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe(true);
    expect(isNotification({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(false);
    // id 0 is a real id, not an absent one.
    expect(isNotification({ jsonrpc: "2.0", id: 0, method: "tools/list" })).toBe(false);
  });
});

describe("findRegisteredProject", () => {
  it("matches on the repository root the hub recorded", () => {
    const projects = {
      alpha: { id: "alpha", repoRoot: "/repos/alpha" },
      "beta-9f2a": { id: "beta-9f2a", repoRoot: "/repos/beta" },
    };
    expect(findRegisteredProject(projects, "/repos/beta")).toBe("beta-9f2a");
    expect(findRegisteredProject(projects, "/repos/nothing")).toBeNull();
    expect(findRegisteredProject(undefined, "/repos/alpha")).toBeNull();
  });
});

describe("bridgeStdio against a fake hub", () => {
  let server;
  let url;
  /** Every request the fake hub received. */
  let received;
  /** How the fake hub answers the next POST. */
  let respond;

  beforeEach(async () => {
    received = [];
    respond = (_message, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    };

    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const message = body ? JSON.parse(body) : null;
        received.push({
          method: req.method,
          headers: req.headers,
          message,
        });
        if (req.method === "DELETE") {
          res.writeHead(204);
          res.end();
          return;
        }
        respond(message, res);
      });
    });

    const port = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    url = `http://127.0.0.1:${port}/p/alpha/mcp/rex`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  /** Drive the bridge with `lines` and return what it wrote. */
  async function run(lines, { workspace = "feature" } = {}) {
    const input = new PassThrough();
    const output = new PassThrough();
    const read = collect(output);
    const done = bridgeStdio({ url, workspace, input, output, timeoutMs: 5_000, log: () => {} });
    for (const line of lines) input.write(`${line}\n`);
    input.end();
    await done;
    return framesFrom(read());
  }

  it("round-trips a request and carries the worktree it was launched in", async () => {
    const frames = await run(['{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}']);

    expect(frames).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
    const post = received.find((r) => r.method === "POST");
    expect(post.message).toEqual({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(post.headers["x-ndx-workspace"]).toBe("feature");
    expect(post.headers.accept).toContain("text/event-stream");
    expect(post.headers["content-type"]).toContain("application/json");
  });

  it("omits the workspace header when the launch was in the repository root", async () => {
    await run(['{"jsonrpc":"2.0","id":1,"method":"tools/list"}'], { workspace: null });
    expect(received[0].headers["x-ndx-workspace"]).toBeUndefined();
  });

  it("keeps the session the hub assigns, and gives it back on exit", async () => {
    const sessionId = randomUUID();
    respond = (message, res) => {
      const headers = { "Content-Type": "application/json" };
      // The transport assigns the session on the initialize response.
      if (message?.method === "initialize") headers["Mcp-Session-Id"] = sessionId;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
    };

    await run([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    ]);

    const posts = received.filter((r) => r.method === "POST");
    // The first request cannot carry a session; every later one must.
    expect(posts[0].headers["mcp-session-id"]).toBeUndefined();
    expect(posts[1].headers["mcp-session-id"]).toBe(sessionId);

    const del = received.find((r) => r.method === "DELETE");
    expect(del, "the session was never closed").toBeDefined();
    expect(del.headers["mcp-session-id"]).toBe(sessionId);
  });

  it("forwards a notification and writes nothing back for it", async () => {
    respond = (_message, res) => {
      // 202 with no body is how the transport acknowledges a notification.
      res.writeHead(202);
      res.end();
    };
    const frames = await run(['{"jsonrpc":"2.0","method":"notifications/initialized"}']);

    expect(frames).toEqual([]);
    expect(received[0].message.method).toBe("notifications/initialized");
  });

  it("writes every message of a multi-part SSE response, in order", async () => {
    respond = (message, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { n: 1 } })}\n\n` +
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { done: true } })}\n\n`,
      );
    };

    const frames = await run(['{"jsonrpc":"2.0","id":9,"method":"tools/call"}']);
    expect(frames).toEqual([
      { jsonrpc: "2.0", method: "notifications/progress", params: { n: 1 } },
      { jsonrpc: "2.0", id: 9, result: { done: true } },
    ]);
  });

  it("answers a request the hub rejected, rather than leaving the client waiting", async () => {
    respond = (_message, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no such project" }));
    };

    const [frame] = await run(['{"jsonrpc":"2.0","id":3,"method":"tools/list"}']);
    expect(frame.id).toBe(3);
    expect(frame.error.code).toBe(-32603);
    expect(frame.error.message).toContain("404");
  });

  it("says nothing back for a notification the hub rejected", async () => {
    respond = (_message, res) => { res.writeHead(500); res.end(); };
    expect(await run(['{"jsonrpc":"2.0","method":"notifications/cancelled"}'])).toEqual([]);
  });

  it("answers with an error when the hub cannot be reached at all", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const read = collect(output);
    // A port nothing is listening on: two attempts, then a JSON-RPC error.
    const done = bridgeStdio({
      url: "http://127.0.0.1:1/p/alpha/mcp/rex",
      workspace: null, input, output, timeoutMs: 500, log: () => {},
    });
    input.write('{"jsonrpc":"2.0","id":5,"method":"tools/list"}\n');
    input.end();
    await done;

    const [frame] = framesFrom(read());
    expect(frame.id).toBe(5);
    expect(frame.error.code).toBe(-32603);
  });

  it("ignores a blank or unparseable line without breaking the stream", async () => {
    const frames = await run([
      "",
      "not json at all",
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    ]);
    // The good frame still went, and only it.
    expect(frames).toHaveLength(1);
    expect(received.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("sends frames in the order they arrived", async () => {
    respond = (message, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
    };

    const frames = await run([
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":3,"method":"tools/call"}',
    ]);
    expect(received.filter((r) => r.method === "POST").map((r) => r.message.id)).toEqual([1, 2, 3]);
    expect(frames.map((f) => f.id)).toEqual([1, 2, 3]);
  });
});
