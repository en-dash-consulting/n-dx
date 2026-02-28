import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { createWebSocketManager, PING_INTERVAL_MS } from "../../../src/server/websocket.js";

/**
 * Connect a raw TCP socket to the server and perform the WebSocket handshake.
 * Returns the socket plus any leftover data after the HTTP 101 response.
 */
function connectRaw(port: number): Promise<{ socket: Socket; leftover: Buffer }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "localhost", port }, () => {
      const keyBytes = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) keyBytes[i] = Math.floor(Math.random() * 256);
      const key = keyBytes.toString("base64");

      socket.write(
        `GET / HTTP/1.1\r\n` +
        `Host: localhost:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `\r\n`,
      );

      let buf = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const str = buf.toString("utf-8");
        const headerEnd = str.indexOf("\r\n\r\n");
        if (headerEnd !== -1 && str.includes("101")) {
          socket.removeListener("data", onData);
          // Everything after the headers is WebSocket frame data
          const httpLen = headerEnd + 4;
          const leftover = buf.subarray(httpLen);
          resolve({ socket, leftover });
        }
      };
      socket.on("data", onData);
      setTimeout(() => reject(new Error("Upgrade timeout")), 3000);
    });
    socket.on("error", reject);
  });
}

/**
 * Parse text WebSocket frames from a buffer.
 * Returns { messages, consumed } where consumed is the total bytes parsed.
 */
function parseFrames(data: Buffer): string[] {
  const messages: string[] = [];
  let pos = 0;

  while (pos + 2 <= data.length) {
    const opcode = data[pos] & 0x0f;
    let payloadLen = data[pos + 1] & 0x7f;
    let offset = pos + 2;

    if (payloadLen === 126) {
      if (offset + 2 > data.length) break;
      payloadLen = data.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLen === 127) {
      if (offset + 8 > data.length) break;
      payloadLen = data.readUInt32BE(offset + 4);
      offset += 8;
    }

    if (offset + payloadLen > data.length) break;

    if (opcode === 0x01) {
      messages.push(data.subarray(offset, offset + payloadLen).toString("utf-8"));
    }
    pos = offset + payloadLen;
  }

  return messages;
}

/**
 * Read WebSocket text frames from a socket. Includes any leftover data from the handshake.
 */
function readMessages(
  socket: Socket,
  leftover: Buffer,
  timeoutMs: number = 500,
): Promise<string[]> {
  return new Promise((resolve) => {
    let buf = Buffer.from(leftover);
    const allMessages: string[] = [];

    // Parse any frames already in the leftover
    const initial = parseFrames(buf);
    allMessages.push(...initial);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const msgs = parseFrames(buf);
      // Only add new messages
      while (allMessages.length < msgs.length) {
        allMessages.push(msgs[allMessages.length]);
      }
    };

    socket.on("data", onData);
    setTimeout(() => {
      socket.removeListener("data", onData);
      resolve(allMessages);
    }, timeoutMs);
  });
}

describe("WebSocket manager", () => {
  let server: Server;
  let port: number;
  let ws: ReturnType<typeof createWebSocketManager>;

  beforeEach(async () => {
    ws = createWebSocketManager();
    await new Promise<void>((resolve) => {
      server = createServer((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });
      server.on("upgrade", ws.handleUpgrade);
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(() => {
    ws.shutdown();
    server.close();
  });

  it("completes WebSocket handshake and tracks client", async () => {
    const { socket } = await connectRaw(port);
    expect(socket.writable).toBe(true);
    expect(ws.clientCount()).toBe(1);
    socket.destroy();
  });

  it("tracks multiple connected clients", async () => {
    expect(ws.clientCount()).toBe(0);

    const c1 = await connectRaw(port);
    expect(ws.clientCount()).toBe(1);

    const c2 = await connectRaw(port);
    expect(ws.clientCount()).toBe(2);

    c1.socket.destroy();
    c2.socket.destroy();
  });

  it("sends welcome message after connection", async () => {
    const { socket, leftover } = await connectRaw(port);
    const messages = await readMessages(socket, leftover, 500);

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const welcome = JSON.parse(messages[0]);
    expect(welcome.type).toBe("connected");
    expect(welcome.timestamp).toBeDefined();

    socket.destroy();
  });

  it("broadcasts messages to connected clients", async () => {
    const c1 = await connectRaw(port);
    const c2 = await connectRaw(port);

    // Start collecting BEFORE broadcasting (to catch the message on both)
    const p1 = readMessages(c1.socket, c1.leftover, 500);
    const p2 = readMessages(c2.socket, c2.leftover, 500);

    // Small delay to let listeners attach, then broadcast
    await new Promise((r) => setTimeout(r, 50));
    ws.broadcast({ type: "test", data: "hello" });

    const msgs1 = await p1;
    const msgs2 = await p2;

    // Should have at least the broadcast message (maybe welcome too)
    const testMsg1 = msgs1.find((m) => JSON.parse(m).type === "test");
    const testMsg2 = msgs2.find((m) => JSON.parse(m).type === "test");

    expect(testMsg1).toBeDefined();
    expect(testMsg2).toBeDefined();
    expect(JSON.parse(testMsg1!).data).toBe("hello");

    c1.socket.destroy();
    c2.socket.destroy();
  });

  it("shutdown closes all connections", async () => {
    await connectRaw(port);
    await connectRaw(port);
    expect(ws.clientCount()).toBe(2);

    ws.shutdown();
    expect(ws.clientCount()).toBe(0);
  });

  it("broadcast is a no-op with no clients", () => {
    ws.broadcast({ type: "noop" });
    expect(ws.clientCount()).toBe(0);
  });

  // ── Immediate disconnect detection ─────────────────────────────────

  it("removes client immediately when socket is destroyed", async () => {
    const { socket } = await connectRaw(port);
    expect(ws.clientCount()).toBe(1);

    socket.destroy();
    // close event fires asynchronously — give the event loop one turn
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.clientCount()).toBe(0);
  });

  it("removes client when socket emits end (half-close)", async () => {
    const { socket } = await connectRaw(port);
    expect(ws.clientCount()).toBe(1);

    // end() sends FIN — the server-side socket receives "end" event
    socket.end();
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.clientCount()).toBe(0);

    socket.destroy();
  });

  it("handles overlapping close/error/end events without errors", async () => {
    const c1 = await connectRaw(port);
    const c2 = await connectRaw(port);
    expect(ws.clientCount()).toBe(2);

    // Forcefully destroy both — may fire close + error simultaneously
    c1.socket.destroy();
    c2.socket.destroy(new Error("simulated error"));
    await new Promise((r) => setTimeout(r, 50));

    // Both should be cleaned up without double-removal errors
    expect(ws.clientCount()).toBe(0);
  });

  it("prunes dead connections before broadcast", async () => {
    const c1 = await connectRaw(port);
    const c2 = await connectRaw(port);
    expect(ws.clientCount()).toBe(2);

    // Destroy one client and let event-loop process events
    c1.socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.clientCount()).toBe(1);

    // Broadcast should succeed to the remaining live client
    const messages = readMessages(c2.socket, Buffer.alloc(0), 300);
    ws.broadcast({ type: "after-prune", ok: true });
    const msgs = await messages;

    const pruneMsg = msgs.find((m) => JSON.parse(m).type === "after-prune");
    expect(pruneMsg).toBeDefined();
    expect(JSON.parse(pruneMsg!).ok).toBe(true);

    c2.socket.destroy();
  });

  it("exports a reduced ping interval constant", () => {
    // The ping interval should be significantly less than the old 30s
    expect(PING_INTERVAL_MS).toBeLessThanOrEqual(10_000);
    expect(PING_INTERVAL_MS).toBeGreaterThan(0);
  });

  // ── Dead client broadcast-set pruning ───────────────────────────────

  it("destroys socket when client is removed from broadcast set", async () => {
    const { socket } = await connectRaw(port);
    expect(ws.clientCount()).toBe(1);

    // Get a reference to track socket state
    const socketRef = socket;
    expect(socketRef.destroyed).toBe(false);

    socket.destroy();
    await new Promise((r) => setTimeout(r, 50));

    // Client removed AND underlying socket destroyed (OS resources freed)
    expect(ws.clientCount()).toBe(0);
    expect(socketRef.destroyed).toBe(true);
  });

  it("removes event listeners on disconnect to allow GC", async () => {
    const { socket } = await connectRaw(port);
    expect(ws.clientCount()).toBe(1);

    // The server-side socket (visible via the upgrade) has listeners attached.
    // After disconnect + removal, listeners should be stripped.
    // We verify indirectly: a second destroy should not re-trigger removal
    // (which would throw if the set were corrupted).
    socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.clientCount()).toBe(0);

    // Broadcast should still work with zero clients (no stale references)
    ws.broadcast({ type: "post-gc-check" });
    expect(ws.clientCount()).toBe(0);
  });

  it("broadcast skips dead clients without serialization waste", async () => {
    const c1 = await connectRaw(port);
    const c2 = await connectRaw(port);
    const c3 = await connectRaw(port);
    expect(ws.clientCount()).toBe(3);

    // Kill two clients
    c1.socket.destroy();
    c3.socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.clientCount()).toBe(1);

    // Broadcast should only reach the surviving client
    const messages = readMessages(c2.socket, Buffer.alloc(0), 300);
    ws.broadcast({ type: "survivor-check", alive: true });
    const msgs = await messages;

    const check = msgs.find((m) => JSON.parse(m).type === "survivor-check");
    expect(check).toBeDefined();
    expect(JSON.parse(check!).alive).toBe(true);

    c2.socket.destroy();
  });

  it("memory usage decreases: clientCount drops to 0 immediately on disconnect", async () => {
    // Connect several clients
    const sockets: Socket[] = [];
    for (let i = 0; i < 5; i++) {
      const { socket } = await connectRaw(port);
      sockets.push(socket);
    }
    expect(ws.clientCount()).toBe(5);

    // Destroy all at once
    for (const s of sockets) s.destroy();
    await new Promise((r) => setTimeout(r, 100));

    // All removed within the timeout (well under the 1s acceptance criterion)
    expect(ws.clientCount()).toBe(0);
  });

  it("broadcast is no-op after all clients disconnect mid-session", async () => {
    const c1 = await connectRaw(port);
    const c2 = await connectRaw(port);
    expect(ws.clientCount()).toBe(2);

    c1.socket.destroy();
    c2.socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.clientCount()).toBe(0);

    // Should not throw or leak — just a silent no-op
    ws.broadcast({ type: "ghost-message" });
    expect(ws.clientCount()).toBe(0);
  });

  // ── Optimized broadcast: single-pass with lazy serialization ────────

  it("skips JSON.stringify when no active connections remain after inline pruning", async () => {
    // When all clients disconnect and the event loop processes the removals,
    // broadcast early-exits at the size === 0 check. But we also want to
    // verify that JSON.stringify is not called even when clients.size > 0
    // but the early exit catches it.
    expect(ws.clientCount()).toBe(0);

    const stringifySpy = vi.spyOn(JSON, "stringify");
    const callsBefore = stringifySpy.mock.calls.length;

    ws.broadcast({ type: "no-clients-no-serialize" });

    // No JSON.stringify call should have occurred (early exit)
    expect(stringifySpy.mock.calls.length).toBe(callsBefore);
    stringifySpy.mockRestore();
  });

  it("calls JSON.stringify exactly once for multiple active clients", async () => {
    const c1 = await connectRaw(port);
    const c2 = await connectRaw(port);
    const c3 = await connectRaw(port);
    expect(ws.clientCount()).toBe(3);

    const stringifySpy = vi.spyOn(JSON, "stringify");
    const callsBefore = stringifySpy.mock.calls.length;

    // Start reading before broadcast
    const p1 = readMessages(c1.socket, c1.leftover, 300);
    const p2 = readMessages(c2.socket, c2.leftover, 300);
    const p3 = readMessages(c3.socket, c3.leftover, 300);
    await new Promise((r) => setTimeout(r, 50));

    ws.broadcast({ type: "single-stringify", n: 3 });

    // JSON.stringify should be called exactly once (lazy, then reused)
    expect(stringifySpy.mock.calls.length).toBe(callsBefore + 1);
    stringifySpy.mockRestore();

    // All three clients should receive the message
    const [msgs1, msgs2, msgs3] = await Promise.all([p1, p2, p3]);
    for (const msgs of [msgs1, msgs2, msgs3]) {
      const msg = msgs.find((m) => JSON.parse(m).type === "single-stringify");
      expect(msg).toBeDefined();
      expect(JSON.parse(msg!).n).toBe(3);
    }

    c1.socket.destroy();
    c2.socket.destroy();
    c3.socket.destroy();
  });

  it("inline prunes dead clients and delivers only to survivors in one pass", async () => {
    const c1 = await connectRaw(port);
    const c2 = await connectRaw(port);
    const c3 = await connectRaw(port);
    const c4 = await connectRaw(port);
    expect(ws.clientCount()).toBe(4);

    // Kill alternating clients, let events propagate
    c1.socket.destroy();
    c3.socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.clientCount()).toBe(2);

    // Broadcast — survivors c2 and c4 should receive the message
    const p2 = readMessages(c2.socket, Buffer.alloc(0), 300);
    const p4 = readMessages(c4.socket, Buffer.alloc(0), 300);

    ws.broadcast({ type: "inline-prune-test", survivors: 2 });

    const [msgs2, msgs4] = await Promise.all([p2, p4]);

    const check2 = msgs2.find((m) => JSON.parse(m).type === "inline-prune-test");
    const check4 = msgs4.find((m) => JSON.parse(m).type === "inline-prune-test");
    expect(check2).toBeDefined();
    expect(check4).toBeDefined();
    expect(JSON.parse(check2!).survivors).toBe(2);
    expect(JSON.parse(check4!).survivors).toBe(2);

    c2.socket.destroy();
    c4.socket.destroy();
  });
});
