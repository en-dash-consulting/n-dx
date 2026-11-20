/**
 * JSON requests. `getJson` and `sendJson` serve callers that treat every
 * failure alike: the Sidecar hooks (`use-sidecar`, its sessions list and
 * attachment, and the hub session page), the project metadata read, the
 * tooling panel and the Delivery view. In utils/ rather than hooks/ so a
 * component or view can import it directly, without the full hooks barrel.
 *
 * A read answers null for anything but a 2xx — and for a request that throws —
 * since every caller treats "no answer" the same way. A write answers the
 * parsed body, or the server's `error` text for the operator to read.
 * `fetchWithJsonBody` only sends, for callers that read the response
 * themselves.
 */

import { errorMessage } from "./format.js";

/** GET `url` as JSON; null when it fails or answers non-2xx. */
export async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

/** Send `body`, when there is one, as JSON; the raw response. */
export function fetchWithJsonBody(method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Send a JSON body; the parsed answer, or the server's error text. */
export async function sendJson<T>(
  method: "POST" | "PATCH",
  url: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Request failed (${res.status})` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
