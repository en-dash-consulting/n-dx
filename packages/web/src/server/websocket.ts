/**
 * WebSocket support for real-time updates.
 *
 * Implements the WebSocket protocol (RFC 6455) using only Node.js built-in
 * modules — no external dependencies required.
 *
 * Supports:
 * - Broadcasting PRD item changes to connected clients
 * - Broadcasting file-change events (sourcevision data updates)
 * - Immediate disconnect detection via socket events + pre-broadcast pruning
 * - Ping/pong keepalive (reduced interval safety net)
 */

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/** A broadcast function that sends a message to all connected clients. */
export type WebSocketBroadcaster = (data: unknown) => void;

/** A connected WebSocket client. */
interface WSClient {
  socket: Duplex;
  alive: boolean;
}

/**
 * Keepalive ping interval (ms). Reduced from 30 s for faster detection
 * of silently dropped connections. Primary disconnect detection is
 * event-driven (close/error/end handlers); pings are a safety net for
 * connections that go silent without a TCP FIN/RST.
 */
export const PING_INTERVAL_MS = 5_000;

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-5AB9DC65B11D";

/** Compute the Sec-WebSocket-Accept header value. */
function computeAcceptKey(key: string): string {
  return createHash("sha1").update(key + WS_MAGIC).digest("base64");
}

/** Encode a text message as a WebSocket frame. */
function encodeFrame(data: string): Buffer {
  const payload = Buffer.from(data, "utf-8");
  const len = payload.length;

  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    // Write as two 32-bit values (BigInt not needed for reasonable payloads)
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }

  return Buffer.concat([header, payload]);
}

/** Encode a close frame. */
function encodeCloseFrame(code: number = 1000): Buffer {
  const buf = Buffer.alloc(4);
  buf[0] = 0x88; // FIN + close opcode
  buf[1] = 2;    // payload length
  buf.writeUInt16BE(code, 2);
  return buf;
}

/** Encode a pong frame. */
function encodePongFrame(payload?: Buffer): Buffer {
  if (!payload || payload.length === 0) {
    const buf = Buffer.alloc(2);
    buf[0] = 0x8a; // FIN + pong opcode
    buf[1] = 0;
    return buf;
  }
  const buf = Buffer.alloc(2 + payload.length);
  buf[0] = 0x8a;
  buf[1] = payload.length;
  payload.copy(buf, 2);
  return buf;
}

/** Encode a ping frame. */
function encodePingFrame(): Buffer {
  const buf = Buffer.alloc(2);
  buf[0] = 0x89; // FIN + ping opcode
  buf[1] = 0;
  return buf;
}

/**
 * Create a WebSocket manager that handles upgrades and broadcasting.
 *
 * Usage:
 * ```ts
 * const ws = createWebSocketManager();
 * server.on("upgrade", ws.handleUpgrade);
 * ws.broadcast({ type: "rex:item-updated", itemId: "..." });
 * ```
 */
export function createWebSocketManager(): {
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  broadcast: WebSocketBroadcaster;
  clientCount: () => number;
  shutdown: () => void;
} {
  const clients = new Set<WSClient>();
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Idempotent client removal — safe to call from multiple event handlers.
   *
   * Performs full cleanup in a single call:
   *  1. Removes from the broadcast set (stops future broadcasts immediately)
   *  2. Strips event listeners (breaks closure references for GC)
   *  3. Destroys the underlying socket (releases OS resources)
   *
   * Because listeners are removed before the socket is destroyed, the
   * destroy → close → removeClient chain cannot recurse.
   */
  function removeClient(client: WSClient): void {
    if (!clients.delete(client)) return; // already removed — nothing to do

    // Break closure references so the client + socket can be GC'd immediately.
    client.socket.removeAllListeners();

    // Release the OS socket if still open.
    if (!client.socket.destroyed) {
      client.socket.destroy();
    }
  }

  /**
   * Remove clients whose underlying socket is no longer writable.
   * Called before each broadcast to catch connections that died between
   * event-loop ticks without emitting a socket event.
   *
   * Uses removeClient() for full cleanup (listener removal + socket destroy).
   */
  function pruneDeadClients(): void {
    for (const client of clients) {
      if (client.socket.destroyed || !client.socket.writable) {
        removeClient(client);
      }
    }
  }

  // Keepalive pings — safety net for connections that go silent without
  // a TCP FIN/RST (e.g. network drops). Primary detection is event-driven.
  function startPingInterval(): void {
    if (pingInterval) return;
    pingInterval = setInterval(() => {
      for (const client of clients) {
        if (!client.alive) {
          // Missed last ping — full cleanup via removeClient
          removeClient(client);
          continue;
        }
        client.alive = false;
        try {
          client.socket.write(encodePingFrame());
        } catch {
          removeClient(client);
        }
      }
    }, PING_INTERVAL_MS);
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    // Enable TCP-level keepalive for OS-level dead-peer detection.
    // The socket is typed as Duplex but is a net.Socket at runtime;
    // guard with runtime checks so non-TCP transports still work.
    const sock = socket as unknown as Record<string, unknown>;
    if (typeof sock.setKeepAlive === "function") {
      (sock.setKeepAlive as (enable: boolean, initialDelay: number) => void)(true, 1000);
    }
    if (typeof sock.setNoDelay === "function") {
      (sock.setNoDelay as (noDelay: boolean) => void)(true);
    }

    const acceptKey = computeAcceptKey(key);

    // Send the handshake response
    const response = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "",
      "",
    ].join("\r\n");

    socket.write(response);

    const client: WSClient = { socket, alive: true };
    clients.add(client);
    startPingInterval();

    // Process any data that was already buffered
    if (head.length > 0) {
      processData(client, head);
    }

    socket.on("data", (data: Buffer) => {
      processData(client, data);
    });

    // Immediate disconnect detection — every socket lifecycle event that
    // signals the connection is gone triggers client removal. Set.delete
    // is idempotent so overlapping events are harmless.
    socket.on("close", () => removeClient(client));
    socket.on("error", () => removeClient(client));
    socket.on("end", () => removeClient(client));

    // Send a welcome message
    try {
      const welcomeMsg = JSON.stringify({
        type: "connected",
        timestamp: new Date().toISOString(),
      });
      socket.write(encodeFrame(welcomeMsg));
    } catch {
      // ignore
    }
  }

  /** Parse incoming WebSocket frames (simplified — handles text, close, ping, pong). */
  function processData(client: WSClient, data: Buffer): void {
    if (data.length < 2) return;

    const opcode = data[0] & 0x0f;
    const masked = (data[1] & 0x80) !== 0;
    let payloadLen = data[1] & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (data.length < 4) return;
      payloadLen = data.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (data.length < 10) return;
      payloadLen = data.readUInt32BE(6); // Ignore high 4 bytes
      offset = 10;
    }

    let maskKey: Buffer | null = null;
    if (masked) {
      if (data.length < offset + 4) return;
      maskKey = data.subarray(offset, offset + 4);
      offset += 4;
    }

    if (data.length < offset + payloadLen) return;

    const payload = data.subarray(offset, offset + payloadLen);
    if (maskKey) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }

    switch (opcode) {
      case 0x01: // Text frame
        // Client messages are acknowledged but not processed further
        client.alive = true;
        break;
      case 0x08: // Close
        try { client.socket.write(encodeCloseFrame()); } catch { /* ignore */ }
        removeClient(client);
        break;
      case 0x09: // Ping
        client.alive = true;
        try { client.socket.write(encodePongFrame(payload)); } catch { /* ignore */ }
        break;
      case 0x0a: // Pong
        client.alive = true;
        break;
    }
  }

  function broadcast(data: unknown): void {
    if (clients.size === 0) return;

    // Pre-broadcast health check: remove dead connections before writing
    // so we never attempt I/O on a destroyed socket.
    pruneDeadClients();
    if (clients.size === 0) return;

    const msg = encodeFrame(JSON.stringify(data));
    for (const client of clients) {
      try {
        client.socket.write(msg);
      } catch {
        removeClient(client);
      }
    }
  }

  function clientCount(): number {
    return clients.size;
  }

  function shutdown(): void {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    for (const client of clients) {
      try {
        client.socket.write(encodeCloseFrame());
        client.socket.destroy();
      } catch {
        // ignore
      }
    }
    clients.clear();
  }

  return { handleUpgrade, broadcast, clientCount, shutdown };
}
