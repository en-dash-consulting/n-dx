/**
 * Preconditions for a real-vendor run: the vendor CLI is on PATH and the
 * dashboard's own credential probe (`ndx auth`) says it can answer.
 */

import { isExecutableOnPath } from "@n-dx/llm-client";

/**
 * Resolve through `where`/`which` without a shell: passing args with
 * `shell: true` trips DEP0190, and a `.cmd` shim cannot run without one. A
 * broken install still fails the credential probe that follows.
 */
export function hasCli(name: "claude" | "codex"): boolean {
  return isExecutableOnPath(name);
}

export interface AuthProbe {
  ok: boolean;
  output: string;
  error: string | null;
}

/** `GET /api/commands/auth?refresh=true` — never 500s; failure is in the body. */
export async function probeCredentials(baseUrl: string): Promise<AuthProbe> {
  const res = await fetch(`${baseUrl}/api/commands/auth?refresh=true`);
  const body = (await res.json().catch(() => ({}))) as Partial<AuthProbe>;
  return {
    ok: body.ok === true,
    output: body.output ?? "",
    error: body.error ?? (res.ok ? null : `HTTP ${res.status}`),
  };
}
