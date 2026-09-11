import { describe, it, expect } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { jsonResponse, errorResponse, readBody, MAX_REQUEST_BODY_BYTES } from "../../../src/server/response-utils.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

/** Minimal test server that calls a handler and captures the response. */
function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("jsonResponse", () => {
  it("sets Content-Type: application/json", async () => {
    const { server, port } = await withServer((_req, res) => {
      jsonResponse(res, 200, { ok: true });
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.headers.get("content-type")).toBe("application/json");
    } finally {
      await closeRouteTestServer(server);
    }
  });

  it("sets Cache-Control: no-cache", async () => {
    const { server, port } = await withServer((_req, res) => {
      jsonResponse(res, 200, { ok: true });
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    } finally {
      await closeRouteTestServer(server);
    }
  });

  it("sends the status code", async () => {
    const { server, port } = await withServer((_req, res) => {
      jsonResponse(res, 201, { id: "abc" });
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(201);
    } finally {
      await closeRouteTestServer(server);
    }
  });

  it("serializes the data body as JSON", async () => {
    const { server, port } = await withServer((_req, res) => {
      jsonResponse(res, 200, { name: "test", count: 42 });
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      const body = await res.json();
      expect(body).toEqual({ name: "test", count: 42 });
    } finally {
      await closeRouteTestServer(server);
    }
  });
});

describe("errorResponse", () => {
  it("sets Content-Type: application/json", async () => {
    const { server, port } = await withServer((_req, res) => {
      errorResponse(res, 404, "Not found");
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.headers.get("content-type")).toBe("application/json");
    } finally {
      await closeRouteTestServer(server);
    }
  });

  it("sets Cache-Control: no-cache (consistent with jsonResponse)", async () => {
    const { server, port } = await withServer((_req, res) => {
      errorResponse(res, 404, "Not found");
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    } finally {
      await closeRouteTestServer(server);
    }
  });

  it("sends the status code", async () => {
    const { server, port } = await withServer((_req, res) => {
      errorResponse(res, 400, "Bad request");
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(400);
    } finally {
      await closeRouteTestServer(server);
    }
  });

  it("wraps the message in { error } shape", async () => {
    const { server, port } = await withServer((_req, res) => {
      errorResponse(res, 500, "Something went wrong");
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      const body = await res.json();
      expect(body).toEqual({ error: "Something went wrong" });
    } finally {
      await closeRouteTestServer(server);
    }
  });
});

describe("readBody size cap", () => {
  /** A minimal IncomingMessage stand-in: an event emitter with a spied destroy. */
  function fakeRequest(): IncomingMessage & { destroyed: boolean } {
    const req = new EventEmitter() as unknown as IncomingMessage & { destroyed: boolean };
    req.destroyed = false;
    (req as unknown as { destroy: () => void }).destroy = () => { (req as { destroyed: boolean }).destroyed = true; };
    return req;
  }

  it("resolves a normal body unchanged", async () => {
    const req = fakeRequest();
    const promise = readBody(req);
    req.emit("data", Buffer.from('{"a":1}'));
    req.emit("end");
    expect(await promise).toBe('{"a":1}');
  });

  it("rejects and destroys the request when the body exceeds the cap", async () => {
    const req = fakeRequest();
    const promise = readBody(req);
    // Two chunks straddling the cap so the overflow is detected mid-stream,
    // not only from a single oversized allocation.
    req.emit("data", Buffer.alloc(MAX_REQUEST_BODY_BYTES - 1));
    req.emit("data", Buffer.alloc(2));
    await expect(promise).rejects.toThrow(/exceeds the .* limit/);
    expect((req as { destroyed: boolean }).destroyed).toBe(true);
  });

  it("accepts a body exactly at the cap", async () => {
    const req = fakeRequest();
    const promise = readBody(req);
    req.emit("data", Buffer.alloc(MAX_REQUEST_BODY_BYTES));
    req.emit("end");
    expect((await promise).length).toBe(MAX_REQUEST_BODY_BYTES);
  });
});
