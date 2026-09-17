/**
 * Which browser origins a loopback server may trust.
 *
 * Both servers in this package are loopback-only and unauthenticated, so the
 * `Origin` header is the whole of their access control against a web page the
 * user happens to have open: any site can `fetch("http://localhost:3117/…")`,
 * and without a check the page's request is indistinguishable from the
 * dashboard's own.
 *
 * The rule is the same on both — an origin is trusted when it is plain HTTP
 * loopback on *this* server's own listening port — but the two learn that port
 * differently: the project server reads `req.socket.localPort`, and the hub
 * knows the port it bound. Comparing against the port rather than the `Host`
 * header is what stops a DNS-rebinding origin presenting a matching host.
 *
 * Framework-agnostic and pure, so the hub can apply the rule without importing
 * from `src/server/` (which its zone boundary forbids).
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "http:" ? 80 : 443;
}

/**
 * True when `origin` names plain-HTTP loopback on `port`.
 *
 * An unparseable origin, a non-loopback host, `https:`, the literal `"null"`
 * (a sandboxed iframe or a `file://` page) and an undefined port are all
 * untrusted.
 */
export function isLoopbackOriginOnPort(origin: string, port: number | undefined): boolean {
  if (port === undefined) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && LOOPBACK_HOSTNAMES.has(url.hostname)
      && effectivePort(url) === port;
  } catch {
    return false;
  }
}

/** The origin a loopback server on `port` presents as its own. */
export function loopbackOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}
