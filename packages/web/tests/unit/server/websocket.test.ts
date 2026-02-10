import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { createWebSocketManager } from "../../../src/server/websocket.js";

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
});
