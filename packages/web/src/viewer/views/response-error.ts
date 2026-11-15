/**
 * The server's `{ error }` out of a failed response, as the settings and Live
 * views word it. Each helper keeps one existing wording, so every view says
 * exactly what it said when it carried its own copy.
 *
 * @module web/viewer/views/response-error
 */

/**
 * The body's `error`: `unreadable` when the body is not JSON, `missing`
 * (by default the same text) when it is JSON that names no error.
 */
export async function responseError(res: Response, unreadable: string, missing: string = unreadable): Promise<string> {
  const body = await res.json().catch(() => ({ error: unreadable }));
  return (body as { error?: string }).error ?? missing;
}

/** The body's `error`, or `fallback` with the HTTP status when there is none to read. */
export async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${res.status})`;
}
