import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { createWebSocketManager, WsHealthTracker } from "../../src/server/websocket.js";

/**
 * Connect a raw TCP socket to the server and perform the WebSocket handshake.
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

describe("WebSocket health tracker integration", { timeout: 120_000 }, () => {
  let server: Server;
  let port: number;
  let ws: ReturnType<typeof createWebSocketManager>;
  let tracker: WsHealthTracker;

  beforeEach(async () => {
    tracker = new WsHealthTracker();
    ws = createWebSocketManager({ healthTracker: tracker });
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

  it("records connections accepted via the tracker", async () => {
    const { socket } = await connectRaw(port);
    expect(tracker.getSnapshot().activeConnections).toBe(1);
    expect(tracker.getSnapshot().totalConnectionsAccepted).toBe(1);
    socket.destroy();
  });

  it("records disconnections with correct reason", async () => {
    const { socket } = await connectRaw(port);
    expect(tracker.getSnapshot().activeConnections).toBe(1);

    socket.destroy();
    await new Promise((r) => setTimeout(r, 50));

    const snap = tracker.getSnapshot();
    expect(snap.activeConnections).toBe(0);
    expect(snap.totalConnectionsRemoved).toBe(1);
    // Should have been removed via close/error/end event
    const eventDriven =
      snap.cleanupsByReason.close +
      snap.cleanupsByReason.error +
      snap.cleanupsByReason.end;
    expect(eventDriven).toBeGreaterThanOrEqual(1);
  });

  it("records broadcasts via the tracker", async () => {
    const { socket } = await connectRaw(port);

    ws.broadcast({ type: "test", data: "hello" });
    ws.broadcast({ type: "test", data: "world" });

    const snap = tracker.getSnapshot();
    expect(snap.totalBroadcasts).toBe(2);

    socket.destroy();
  });

  it("tracks peak connections across multiple connect/disconnect cycles", async () => {
    const c1 = await connectRaw(port);
    const c2 = await connectRaw(port);
    const c3 = await connectRaw(port);
    expect(tracker.getSnapshot().peakConnections).toBe(3);

    c1.socket.destroy();
    c2.socket.destroy();
    await new Promise((r) => setTimeout(r, 50));

    expect(tracker.getSnapshot().peakConnections).toBe(3);
    expect(tracker.getSnapshot().activeConnections).toBe(1);

    c3.socket.destroy();
  });

  it("records shutdown reason when shutdown is called", async () => {
    await connectRaw(port);
    await connectRaw(port);
    expect(tracker.getSnapshot().activeConnections).toBe(2);

    ws.shutdown();

    const snap = tracker.getSnapshot();
    expect(snap.cleanupsByReason.shutdown).toBe(2);
  });

  it("provides a health snapshot with all required fields", async () => {
    const { socket } = await connectRaw(port);
    ws.broadcast({ type: "test" });

    const snap = tracker.getSnapshot();
    expect(snap).toHaveProperty("activeConnections");
    expect(snap).toHaveProperty("peakConnections");
    expect(snap).toHaveProperty("totalConnectionsAccepted");
    expect(snap).toHaveProperty("cleanupsByReason");
    expect(snap).toHaveProperty("totalBroadcasts");
    expect(snap).toHaveProperty("health");
    expect(snap).toHaveProperty("timestamp");
    expect(snap).toHaveProperty("uptimeMs");

    socket.destroy();
  });
});
