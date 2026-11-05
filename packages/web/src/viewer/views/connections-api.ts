/**
 * What the Connections section's parts share: the shapes the connections
 * routes answer (routes-connections.ts) and the request helpers. A token is
 * only ever sent, never held here beyond the field it is typed into, and no
 * route answers one.
 */

export interface ConnectionProfile {
  name: string;
  state: "ok" | "unchecked" | "invalid";
  problem?: string;
}

export interface ConnectionRow {
  id: string;
  label: string;
  transport: "http" | "stdio";
  auth: "none" | "token" | "oauth";
  state: "connected" | "unavailable" | "needs-sign-in";
  reason?: string;
  /** On a needs-sign-in row: the first sign-in, or one the connection had and lost. */
  signIn?: "first" | "again";
  tools: number;
  /** On a token connection: whether a token is stored. */
  tokenStored?: boolean;
  profile?: ConnectionProfile;
}

export interface ToolRow {
  tool: string;
  description: string;
  class: "read" | "write";
  classSource: "annotation" | "default" | "override";
  policy: "run" | "ask" | "never";
  policySource: "annotation" | "default" | "override";
}

export interface Notice {
  kind: "ok" | "error";
  text: string;
}

export type ReportNotice = (notice: Notice | null) => void;

export async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON: the status says enough.
  }
  return `HTTP ${res.status}`;
}

export function send(method: "POST" | "PUT" | "DELETE", path: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const connectionPath = (id: string): string => `/api/connections/${encodeURIComponent(id)}`;

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The state as Settings words it. */
export function connectionStateLabel(row: Pick<ConnectionRow, "state" | "reason" | "signIn">): string {
  if (row.state === "connected") return "connected";
  if (row.state === "unavailable") return `connection unavailable: ${row.reason ?? "unknown reason"}`;
  // The server says whether the connection lost a sign-in it had; the reason text is only shown.
  return row.signIn === "again" ? "sign in again" : "sign in";
}

export const TOOL_CLASSES = ["read", "write"] as const;
export const TOOL_POLICIES = ["run", "ask", "never"] as const;
