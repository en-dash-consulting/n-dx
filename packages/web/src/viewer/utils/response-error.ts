/**
 * The server's `{ error }` out of a failed response, as the components, hooks
 * and views word it. Each helper keeps one existing wording, so every caller
 * says exactly what it said when it carried its own copy.
 *
 * @module web/viewer/utils/response-error
 */

/**
 * The body's `error`: `unreadable` when the body is not JSON, `missing`
 * (by default the same text) when it is JSON that names no error.
 */
export async function responseError(res: Response, unreadable: string, missing: string = unreadable): Promise<string> {
  const body = await res.json().catch(() => ({ error: unreadable }));
  return (body as { error?: string }).error ?? missing;
}

/**
 * The body's `error`, or `HTTP <status>` when it names none. A body that is
 * not JSON reads as `unreadable` — or as `HTTP <status>` when that is omitted.
 */
export async function errorOrHttpStatus(res: Response, unreadable?: string): Promise<string> {
  const body = await res.json().catch(() => ({ error: unreadable })) as { error?: string };
  return body.error || `HTTP ${res.status}`;
}

/**
 * For a POST that starts a background job: return when the job started, or
 * when one is already running (409, which the job tray reports); otherwise
 * throw the body's `error`, or `HTTP <status>` when it names none.
 */
export async function assertJobStarted(res: Response): Promise<void> {
  if (res.ok || res.status === 409) return;
  throw new Error(await errorOrHttpStatus(res));
}

/** The body's `error`, or `fallback` with the HTTP status when there is none to read. */
export async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${res.status})`;
}
