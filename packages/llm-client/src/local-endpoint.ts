/**
 * The one shape rule for the local LLM endpoint.
 *
 * `llm.local.host` and `llm.local.port` are spliced into
 * `http://${host}:${port}/v1/…` by three surfaces: inference
 * (`local-api-provider.ts`), the dashboard's probes and smoke test
 * (`packages/web/src/server/routes-llm.ts`) and the `ndx config` write that
 * stores them (`packages/core/config.js`). A value the URL parser would read
 * as anything other than a host — a path, a query, credentials, a second
 * port — rewrites that request instead of addressing it, so every surface
 * must refuse the same values. This module is where the rule lives.
 *
 * The orchestration tier imports nothing from packages (spawn-only rule), so
 * `packages/core/config.js` carries an inline twin of both predicates and
 * `tests/unit/local-endpoint-parity.test.js` holds the two equal over a table
 * of hosts and ports. Change both in the same commit.
 */

/** Host used when `llm.local.host` is unset: LM Studio on this machine. */
export const DEFAULT_LOCAL_HOST = "localhost";

/** Port used when `llm.local.port` is unset: LM Studio's default. */
export const DEFAULT_LOCAL_PORT = 1234;

/** RFC 1035's ceiling on a DNS name; longer than this cannot resolve. */
const MAX_HOST_LENGTH = 253;

/**
 * Whether `host` is something `http://${host}:${port}/v1/…` can only ever
 * address as a host. The probes and the smoke test splice the configured
 * host straight into a URL, so a value carrying `/`, `?`, `#`, `@`, `\` or
 * whitespace would rewrite the path, the query or the authority of the
 * request instead — `127.0.0.1/x?` fetches `/x?:1234/v1/models`, and
 * `u@127.0.0.1` sends credentials. The round trip through `URL` proves the
 * whole string is consumed as the hostname: no username, no path, nothing
 * swallowed by the parser.
 *
 * This is a shape check, not an allowlist. A LAN GPU box is a supported
 * configuration and `local-api-provider.ts` builds the same URL for real
 * inference, so loopback-only would break a working setup; the endpoints
 * that use this are already behind the token and Origin gate.
 */
export function isPlausibleLlmHost(host: unknown): host is string {
  if (typeof host !== "string" || host.length === 0 || host.length > MAX_HOST_LENGTH) return false;
  if (/[\s/?#@\\]/.test(host)) return false;
  let url: URL;
  try {
    url = new URL(`http://${host}:1/`);
  } catch {
    return false;
  }
  // The whole input must have become the authority and nothing else. Compare
  // the round-tripped URL, not the hostname text: WHATWG normalises `127.1`,
  // an expanded IPv6 literal or an IDN name, and inference accepts all three.
  return url.href === `http://${url.hostname}:1/`;
}

/** Whether `port` is a TCP port: an integer from 1 to 65535. */
export function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * What is wrong with a host and port pair, or `null` when both pass. The
 * host is reported first, so a pair that fails both names the host. The
 * wording is shared by the dashboard's 400 answers and the inference
 * provider's refusal, so an operator sees one message wherever a hand-edited
 * `.n-dx.json` is caught.
 */
export function describeLocalEndpointProblem(host: unknown, port: unknown): string | null {
  if (!isPlausibleLlmHost(host)) {
    return `Invalid LLM host ${JSON.stringify(host)}: expected a hostname, an IPv4 address or a bracketed IPv6 address with no port, path, credentials or whitespace.`;
  }
  if (!isValidPort(port)) {
    return `Invalid LLM port ${JSON.stringify(port)}: expected an integer from 1 to 65535.`;
  }
  return null;
}
