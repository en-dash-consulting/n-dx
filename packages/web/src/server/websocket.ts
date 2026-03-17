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
 * - Connection health tracking and lifecycle metrics
 */

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// ── Health tracking types ──────────────────────────────────────────────────

/** Reason a client was removed from the connection set. */
export type CleanupReason =
  | "close"     // Socket close event (clean disconnect)
  | "error"     // Socket error event
  | "end"       // Socket end event (half-close)
  | "ping_timeout" // Missed keepalive ping response
  | "prune"     // Pre-broadcast pruning (destroyed/non-writable socket)
  | "shutdown"  // Server shutdown
  | "write_fail"; // Failed write during broadcast

/** A single cleanup event record. */
interface CleanupEvent {
  reason: CleanupReason;
  timestamp: number; // Date.now()
  connectionDurationMs: number; // How long the client was connected
}

/** Health level derived from cleanup failure rate and connection trends. */
export type WsHealthLevel = "healthy" | "degraded" | "unhealthy";

/** Snapshot of WebSocket health metrics for API/broadcast consumption. */
export interface WsHealthSnapshot {
  /** Current number of active connections. */
  activeConnections: number;
  /** Peak concurrent connections seen since server start. */
  peakConnections: number;
  /** Total connections accepted since server start. */
  totalConnectionsAccepted: number;
  /** Total connections removed (for any reason) since server start. */
  totalConnectionsRemoved: number;
  /** Cleanup metrics broken down by reason. */
  cleanupsByReason: Record<CleanupReason, number>;
  /** Number of cleanups in the last 60 seconds. */
  recentCleanups: number;
  /** Average connection duration (ms) for connections closed in the last 5 minutes. */
  avgConnectionDurationMs: number;
  /** Total broadcasts sent since server start. */
  totalBroadcasts: number;
  /** Total failed writes during broadcasts. */
  totalBroadcastWriteFailures: number;
  /** Cleanup success rate (0–1): successful cleanups / total cleanups. */
  cleanupSuccessRate: number;
  /** Average cleanup timing (ms): how quickly dead connections are detected. */
  avgCleanupLatencyMs: number;
  /** Overall health level. */
  health: WsHealthLevel;
  /** Server uptime in milliseconds. */
  uptimeMs: number;
  /** ISO timestamp of this snapshot. */
  timestamp: string;
}

// ── Health tracker ─────────────────────────────────────────────────────────

/** Maximum number of recent cleanup events to retain for rolling stats. */
const MAX_CLEANUP_HISTORY = 500;

/** Window (ms) for "recent cleanups" count. */
const RECENT_WINDOW_MS = 60_000;

/** Window (ms) for average connection duration calculation. */
const DURATION_WINDOW_MS = 5 * 60_000;

/**
 * WebSocket connection health tracker — records connection lifecycle events,
 * cleanup metrics, and resource usage for dashboard monitoring.
 *
 * Instruments the WebSocket manager to collect:
 * - Active vs total (historical peak) connection counts
 * - Cleanup events: successful removals, reasons, timing
 * - Broadcast statistics: total broadcasts, failed writes
 * - Connection duration tracking
 *
 * Designed as a singleton that accumulates metrics over the server lifetime.
 * Provides a snapshot API consumed by the REST endpoint and WS broadcast.
 */
export class WsHealthTracker {
  private readonly startedAt = Date.now();

  // Connection tracking
  private activeConnectionCount = 0;
  private peakConnectionCount = 0;
  private totalAccepted = 0;
  private totalRemoved = 0;

  // Per-connection timestamps for duration tracking
  private readonly connectionStartTimes = new Map<string, number>();
  private connectionIdCounter = 0;

  // Cleanup history (ring buffer)
  private readonly cleanupHistory: CleanupEvent[] = [];
  private readonly cleanupsByReason: Record<CleanupReason, number> = {
    close: 0,
    error: 0,
    end: 0,
    ping_timeout: 0,
    prune: 0,
    shutdown: 0,
    write_fail: 0,
  };

  // Broadcast tracking
  private totalBroadcasts = 0;
  private totalWriteFailures = 0;

  // Cleanup timing: track ms from connection start to cleanup
  // for "cleanup latency" (how quickly we detect dead connections)
  private cleanupLatencySum = 0;
  private cleanupLatencyCount = 0;

  /**
   * Record a new connection being accepted.
   * Returns a connection ID to pass to `recordDisconnect()`.
   */
  recordConnect(): string {
    const id = String(++this.connectionIdCounter);
    this.connectionStartTimes.set(id, Date.now());
    this.activeConnectionCount++;
    this.totalAccepted++;
    if (this.activeConnectionCount > this.peakConnectionCount) {
      this.peakConnectionCount = this.activeConnectionCount;
    }
    return id;
  }

  /**
   * Record a connection being removed.
   */
  recordDisconnect(connectionId: string, reason: CleanupReason): void {
    const startTime = this.connectionStartTimes.get(connectionId);
    if (!startTime) return; // Already recorded or unknown

    this.connectionStartTimes.delete(connectionId);
    const now = Date.now();
    const durationMs = now - startTime;

    this.activeConnectionCount = Math.max(0, this.activeConnectionCount - 1);
    this.totalRemoved++;
    this.cleanupsByReason[reason]++;

    const event: CleanupEvent = {
      reason,
      timestamp: now,
      connectionDurationMs: durationMs,
    };

    // Ring buffer for cleanup history
    if (this.cleanupHistory.length >= MAX_CLEANUP_HISTORY) {
      this.cleanupHistory.shift();
    }
    this.cleanupHistory.push(event);

    // Accumulate cleanup latency for averaging
    this.cleanupLatencySum += durationMs;
    this.cleanupLatencyCount++;
  }

  /** Record a broadcast attempt. */
  recordBroadcast(): void {
    this.totalBroadcasts++;
  }

  /** Record a failed write during broadcast. */
  recordBroadcastWriteFailure(): void {
    this.totalWriteFailures++;
  }

  /**
   * Sync the active connection count with the actual client set size.
   * Called periodically to correct any drift from missed events.
   */
  syncActiveCount(actualCount: number): void {
    this.activeConnectionCount = actualCount;
    if (actualCount > this.peakConnectionCount) {
      this.peakConnectionCount = actualCount;
    }
  }

  /** Get a snapshot of current health metrics. */
  getSnapshot(): WsHealthSnapshot {
    const now = Date.now();

    // Recent cleanups (last 60s)
    const recentCutoff = now - RECENT_WINDOW_MS;
    const recentCleanups = this.cleanupHistory.filter(
      (e) => e.timestamp >= recentCutoff,
    ).length;

    // Average connection duration for connections closed in last 5 min
    const durationCutoff = now - DURATION_WINDOW_MS;
    const recentDurations = this.cleanupHistory
      .filter((e) => e.timestamp >= durationCutoff)
      .map((e) => e.connectionDurationMs);
    const avgConnectionDurationMs =
      recentDurations.length > 0
        ? Math.round(
            recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length,
          )
        : 0;

    // Cleanup success rate: event-driven cleanups (close/error/end) vs
    // safety-net cleanups (ping_timeout/prune/write_fail)
    const totalCleanups = this.totalRemoved;
    const eventDrivenCleanups =
      this.cleanupsByReason.close +
      this.cleanupsByReason.error +
      this.cleanupsByReason.end +
      this.cleanupsByReason.shutdown;
    const cleanupSuccessRate =
      totalCleanups > 0 ? eventDrivenCleanups / totalCleanups : 1;

    // Average cleanup latency
    const avgCleanupLatencyMs =
      this.cleanupLatencyCount > 0
        ? Math.round(this.cleanupLatencySum / this.cleanupLatencyCount)
        : 0;

    // Health level
    const health = this.computeHealth(cleanupSuccessRate, recentCleanups);

    return {
      activeConnections: this.activeConnectionCount,
      peakConnections: this.peakConnectionCount,
      totalConnectionsAccepted: this.totalAccepted,
      totalConnectionsRemoved: this.totalRemoved,
      cleanupsByReason: { ...this.cleanupsByReason },
      recentCleanups,
      avgConnectionDurationMs,
      totalBroadcasts: this.totalBroadcasts,
      totalBroadcastWriteFailures: this.totalWriteFailures,
      cleanupSuccessRate: Math.round(cleanupSuccessRate * 1000) / 1000,
      avgCleanupLatencyMs,
      health,
      uptimeMs: now - this.startedAt,
      timestamp: new Date().toISOString(),
    };
  }

  /** Reset all counters (for testing). */
  reset(): void {
    this.activeConnectionCount = 0;
    this.peakConnectionCount = 0;
    this.totalAccepted = 0;
    this.totalRemoved = 0;
    this.connectionStartTimes.clear();
    this.connectionIdCounter = 0;
    this.cleanupHistory.length = 0;
    this.cleanupsByReason.close = 0;
    this.cleanupsByReason.error = 0;
    this.cleanupsByReason.end = 0;
    this.cleanupsByReason.ping_timeout = 0;
    this.cleanupsByReason.prune = 0;
    this.cleanupsByReason.shutdown = 0;
    this.cleanupsByReason.write_fail = 0;
    this.totalBroadcasts = 0;
    this.totalWriteFailures = 0;
    this.cleanupLatencySum = 0;
    this.cleanupLatencyCount = 0;
  }

  private computeHealth(
    cleanupSuccessRate: number,
    recentCleanups: number,
  ): WsHealthLevel {
    // Unhealthy: high rate of safety-net cleanups (>30% are prune/timeout/write_fail)
    // or very high cleanup churn (>50 cleanups per minute)
    if (cleanupSuccessRate < 0.7 || recentCleanups > 50) {
      return "unhealthy";
    }
    // Degraded: moderate safety-net usage or moderate churn
    if (cleanupSuccessRate < 0.9 || recentCleanups > 20) {
      return "degraded";
    }
    return "healthy";
  }
}

// ── WebSocket manager ──────────────────────────────────────────────────────

/** A broadcast function that sends a message to all connected clients. */
export type WebSocketBroadcaster = (data: unknown) => void;

/** Options for the WebSocket manager. */
export interface WebSocketManagerOptions {
  /** Optional health tracker for connection lifecycle metrics. */
  healthTracker?: WsHealthTracker;
}

/** A connected WebSocket client. */
interface WSClient {
  socket: Duplex;
  alive: boolean;
  /** Tracker-assigned connection ID for duration tracking. */
  trackingId?: string;
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
export function createWebSocketManager(opts?: WebSocketManagerOptions): {
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  broadcast: WebSocketBroadcaster;
  clientCount: () => number;
  shutdown: () => void;
} {
  const clients = new Set<WSClient>();
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  const tracker = opts?.healthTracker;

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
  function removeClient(client: WSClient, reason?: CleanupReason): void {
    if (!clients.delete(client)) return; // already removed — nothing to do

    // Record the disconnect in the health tracker.
    if (tracker && client.trackingId) {
      tracker.recordDisconnect(client.trackingId, reason ?? "close");
    }

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
        removeClient(client, "prune");
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
          removeClient(client, "ping_timeout");
          continue;
        }
        client.alive = false;
        try {
          client.socket.write(encodePingFrame());
        } catch {
          removeClient(client, "write_fail");
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

    const trackingId = tracker?.recordConnect();
    const client: WSClient = { socket, alive: true, trackingId };
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
    socket.on("close", () => removeClient(client, "close"));
    socket.on("error", () => removeClient(client, "error"));
    socket.on("end", () => removeClient(client, "end"));

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
        removeClient(client, "close");
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

    tracker?.recordBroadcast();

    // Single-pass broadcast: inline health checks replace the separate
    // pruneDeadClients() call, and JSON serialization is deferred until
    // the first confirmed-active connection is found. This means:
    //   1. JSON.stringify is never called unless an active client exists
    //   2. Dead connections are skipped without attempting socket writes
    //   3. Performance scales with active connection count, not set size
    let msg: Buffer | null = null;
    for (const client of clients) {
      if (client.socket.destroyed || !client.socket.writable) {
        removeClient(client, "prune");
        continue;
      }

      // Lazy serialization: only pay the JSON.stringify + frame encoding
      // cost once we have a confirmed-active client to write to.
      if (msg === null) {
        msg = encodeFrame(JSON.stringify(data));
      }

      try {
        client.socket.write(msg);
      } catch {
        tracker?.recordBroadcastWriteFailure();
        removeClient(client, "write_fail");
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
      if (tracker && client.trackingId) {
        tracker.recordDisconnect(client.trackingId, "shutdown");
      }
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
