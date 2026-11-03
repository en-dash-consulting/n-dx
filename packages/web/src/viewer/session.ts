/**
 * The viewer's side of the browser credential.
 *
 * The work happens in the session script every served page starts with
 * (`shared/browser-session.ts`, installed as `window.ndxAuth`): it exchanges
 * the landing nonce, keeps the session credential in `sessionStorage` and
 * puts it on every same-origin `fetch`. This module is the typed face of it
 * for the bundle:
 *
 * - {@link waitForSession} — the boot gate `main.ts` awaits before rendering;
 * - {@link openWebSocket} — every live-feed socket. A browser cannot put a
 *   header on a WebSocket handshake, so on a signed-in page the socket first
 *   fetches a single-use ticket and connects with it in the URL. New code
 *   calls this rather than `new WebSocket(...)`.
 *
 * A static export (`ndx export`) and a server without a token have no
 * credential; both functions then do what the plain browser APIs do.
 */

import { getWebSocketUrl } from "./base-path.js";

interface NdxAuth {
  ready: Promise<{ ok: boolean }>;
  socketUrl(url: string): Promise<string>;
  credential(): string | null;
}

function auth(): NdxAuth | null {
  const w = globalThis as unknown as { ndxAuth?: NdxAuth };
  return w.ndxAuth ?? null;
}

/**
 * Resolves once the page is signed in, or knows it cannot be. `ok: false`
 * means the session script has replaced the page with its sign-in notice and
 * nothing should render over it.
 */
export async function waitForSession(): Promise<{ ok: boolean }> {
  const a = auth();
  if (!a) return { ok: true };
  try {
    return await a.ready;
  } catch {
    return { ok: true };
  }
}

type Handler<E extends Event> = ((this: WebSocket, ev: E) => unknown) | null;

/**
 * A WebSocket whose connection starts once its ticket has arrived. Behaves
 * like the socket it wraps — `readyState`, `send`, `close`, the `on*`
 * handlers and listeners — and reports CONNECTING meanwhile.
 */
class TicketedWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent> = null;
  onclose: Handler<CloseEvent> = null;
  onerror: Handler<Event> = null;

  private inner: WebSocket | null = null;
  private closedEarly = false;
  private requestedBinaryType: BinaryType = "blob";

  constructor(readonly url: string, ticketed: Promise<string>) {
    super();
    void ticketed.then((target) => {
      if (this.closedEarly) return;
      const ws = new WebSocket(target);
      ws.binaryType = this.requestedBinaryType;
      this.inner = ws;
      ws.onopen = () => this.emit("onopen", new Event("open"));
      ws.onerror = () => this.emit("onerror", new Event("error"));
      ws.onmessage = (e) => this.emit("onmessage", new MessageEvent("message", { data: e.data, origin: e.origin }));
      ws.onclose = (e) => this.emit("onclose", new CloseEvent("close", { code: e.code, reason: e.reason, wasClean: e.wasClean }));
    });
  }

  private emit(handler: "onopen" | "onerror" | "onmessage" | "onclose", event: Event): void {
    this.dispatchEvent(event);
    const fn = this[handler] as ((this: unknown, ev: Event) => unknown) | null;
    fn?.call(this, event);
  }

  get readyState(): number {
    if (this.inner) return this.inner.readyState;
    return this.closedEarly ? 3 : 0;
  }
  get bufferedAmount(): number { return this.inner?.bufferedAmount ?? 0; }
  get extensions(): string { return this.inner?.extensions ?? ""; }
  get protocol(): string { return this.inner?.protocol ?? ""; }
  get binaryType(): BinaryType { return this.inner?.binaryType ?? this.requestedBinaryType; }
  set binaryType(value: BinaryType) {
    this.requestedBinaryType = value;
    if (this.inner) this.inner.binaryType = value;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (!this.inner) throw new DOMException("WebSocket is not open", "InvalidStateError");
    this.inner.send(data as string);
  }

  close(code?: number, reason?: string): void {
    if (this.inner) {
      this.inner.close(code, reason);
      return;
    }
    if (this.closedEarly) return;
    this.closedEarly = true;
    setTimeout(() => this.emit("onclose", new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "", wasClean: true })), 0);
  }
}

/**
 * Open the live-feed socket for this viewer's server (`getWebSocketUrl()`
 * unless `url` says otherwise), carrying a ticket when the page is signed in.
 */
export function openWebSocket(url: string = getWebSocketUrl()): WebSocket {
  const a = auth();
  if (!a || !a.credential()) return new WebSocket(url);
  return new TicketedWebSocket(url, a.socketUrl(url)) as unknown as WebSocket;
}

/**
 * Open a server-generated document (the iso map's standalone HTML) in a new
 * tab, or download it. A plain link cannot: the navigation would carry no
 * credential. The document is fetched with one and handed over as a blob.
 */
export async function openFetchedDocument(url: string, options: { download?: string } = {}): Promise<void> {
  // Opened first, synchronously in the click, so a popup blocker allows it.
  const target = options.download ? null : window.open("about:blank", "_blank");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = new Blob([await res.text()], { type: "text/html" });
    const objectUrl = URL.createObjectURL(blob);
    if (options.download) {
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = options.download;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else if (target) {
      target.opener = null;
      target.location.href = objectUrl;
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    target?.close();
  }
}

/**
 * `onClick` for a link to a server-generated document. Without a credential
 * (a static export, an open server) the link navigates as written; with one,
 * the click is taken over by {@link openFetchedDocument}, since the
 * navigation itself would carry no credential. `path` is root-relative —
 * the fetch adds the base path.
 */
export function credentialedLinkClick(path: string, options: { download?: string } = {}): (event: MouseEvent) => void {
  return (event: MouseEvent) => {
    const a = auth();
    if (!a || !a.credential()) return;
    event.preventDefault();
    void openFetchedDocument(path, options);
  };
}
