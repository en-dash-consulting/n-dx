/**
 * Live-feed sockets that hand each frame, parsed, to the caller.
 *
 * - {@link openFrameSocket} opens the socket once. A view that also polls (or
 *   reads once on mount) carries on without it when it cannot open or drops.
 * - {@link openReconnectingSocket} keeps it open: the shared live feed
 *   (`hooks/use-live.ts`) and the Sidecar drawer (`hooks/use-sidecar.ts`)
 *   hold one socket for as long as they are mounted. When it drops, the delay
 *   before the next attempt doubles from the first to the cap, and resets
 *   once a connection opens. With no `WebSocket` at all nothing is opened:
 *   the caller's poll, or its read on open, carries it.
 *
 * A malformed frame — or one the caller's `onFrame` throws on — is dropped.
 * Both open through `openWebSocket()` (`session.ts`), so a signed-in page
 * connects with its single-use ticket.
 */

import type { ParsedWSMessage } from "./messaging/index.js";
import { openWebSocket } from "./session.js";

/** Feed each parsed frame of `ws` to `onFrame`, dropping one that fails. */
function deliverFrames(ws: WebSocket, onFrame: (frame: ParsedWSMessage) => void): void {
  ws.onmessage = (event) => {
    try {
      onFrame(JSON.parse(event.data));
    } catch {
      // Malformed frame — the caller's next read catches up.
    }
  };
}

/**
 * Open the live-feed socket once. `onOpen` and `onClose` become the socket's
 * own handlers when given. Returns what closes it; when the socket cannot
 * open there is nothing to close.
 */
export function openFrameSocket(
  onFrame: (frame: ParsedWSMessage) => void,
  handlers: { onOpen?: () => void; onClose?: () => void } = {},
): () => void {
  let ws: WebSocket;
  try {
    ws = openWebSocket();
  } catch {
    return () => {};
  }
  if (handlers.onOpen) ws.onopen = handlers.onOpen;
  if (handlers.onClose) ws.onclose = handlers.onClose;
  deliverFrames(ws, onFrame);
  return () => {
    try { ws.close(); } catch { /* ignore */ }
  };
}

const RECONNECT_FIRST_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface ReconnectingSocketOptions {
  /** The socket to open, read at every attempt. Omitted: the viewer's own live feed. */
  url?: () => string;
  /** Each frame, parsed. */
  onFrame: (frame: ParsedWSMessage) => void;
  /**
   * The socket opened. `isReconnect` is true for every attempt after the
   * first: frames sent while the socket was down are gone, so catch up.
   */
  onOpen?: (isReconnect: boolean) => void;
  /** The socket dropped while still wanted; a reconnect is scheduled next. */
  onClose?: () => void;
}

/**
 * Open the socket and keep it open. Returns the stop function: it cancels a
 * pending reconnect and closes the socket without firing `onClose`.
 */
export function openReconnectingSocket(options: ReconnectingSocketOptions): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = RECONNECT_FIRST_MS;

  const connect = (isReconnect: boolean): void => {
    if (typeof WebSocket === "undefined") return;
    try {
      ws = options.url ? openWebSocket(options.url()) : openWebSocket();
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      reconnectDelay = RECONNECT_FIRST_MS;
      options.onOpen?.(isReconnect);
    };
    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      options.onClose?.();
      scheduleReconnect();
    };
    deliverFrames(ws, options.onFrame);
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer !== null) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(true);
    }, delay);
  };

  connect(false);

  return () => {
    stopped = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  };
}
