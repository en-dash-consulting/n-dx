import { describe, it, expect } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { jsonResponse, errorResponse } from "../../../src/server/response-utils.js";

/** Minimal test server that calls a handler and captures the response. */
function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, () => {
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
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.headers.get("content-type")).toBe("application/json");
    } finally {
      server.close();
    }
  });

  it("sets Cache-Control: no-cache", async () => {
    const { server, port } = await withServer((_req, res) => {
      jsonResponse(res, 200, { ok: true });
    });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    } finally {
      server.close();
    }
  });

  it("sends the status code", async () => {
    const { server, port } = await withServer((_req, res) => {
      jsonResponse(res, 201, { id: "abc" });
    });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(201);
    } finally {
      server.close();
    }
  });

  it("serializes the data body as JSON", async () => {
    const { server, port } = await withServer((_req, res) => {
      jsonResponse(res, 200, { name: "test", count: 42 });
    });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      const body = await res.json();
      expect(body).toEqual({ name: "test", count: 42 });
    } finally {
      server.close();
    }
  });
});

describe("errorResponse", () => {
  it("sets Content-Type: application/json", async () => {
    const { server, port } = await withServer((_req, res) => {
      errorResponse(res, 404, "Not found");
    });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.headers.get("content-type")).toBe("application/json");
    } finally {
      server.close();
    }
  });

  it("sets Cache-Control: no-cache (consistent with jsonResponse)", async () => {
    const { server, port } = await withServer((_req, res) => {
      errorResponse(res, 404, "Not found");
    });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    } finally {
      server.close();
    }
  });

  it("sends the status code", async () => {
    const { server, port } = await withServer((_req, res) => {
      errorResponse(res, 400, "Bad request");
    });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("wraps the message in { error } shape", async () => {
    const { server, port } = await withServer((_req, res) => {
      errorResponse(res, 500, "Something went wrong");
    });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      const body = await res.json();
      expect(body).toEqual({ error: "Something went wrong" });
    } finally {
      server.close();
    }
  });
});
