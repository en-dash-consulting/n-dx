/**
 * Connections — the read-only section of Settings > Project that lists the
 * MCP servers the operator connected (`connections` in the local config
 * file, whose name the server sends) with their state, and signs OAuth connections in and out. Shown only while
 * `web.sidecar` is on; the Project page decides.
 *
 * Sign-in goes through this page and nothing else. Sign in asks the server
 * for an authorization URL that returns to `<base>/project?connection=<id>`,
 * and the tab goes there. The authorization server sends the tab back with
 * `code` and `state`; the page takes them out of the address bar at once and
 * posts them to `/api/connections/:id/oauth/finish` with the tab's session
 * credential in the header (the session script's fetch), so the server never
 * acts on a credential in a URL. The result shows above the list.
 */

import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { appUrl, getBasePath, replaceAppHistory } from "../base-path.js";

export interface ConnectionRow {
  id: string;
  label: string;
  transport: "http" | "stdio";
  auth: "none" | "token" | "oauth";
  state: "connected" | "unavailable" | "needs-sign-in";
  reason?: string;
  tools: number;
}

interface Notice {
  kind: "ok" | "error";
  text: string;
}

/** The page a sign-in returns to, and the query parameter naming its connection. */
const RETURN_PATH = "/project";
const CONNECTION_PARAM = "connection";
/** What an authorization server adds to the return address. */
const RETURN_PARAMS = [CONNECTION_PARAM, "code", "state", "error", "error_description", "error_uri", "iss"];

/** The state as Settings words it. */
export function connectionStateLabel(row: Pick<ConnectionRow, "state" | "reason">): string {
  if (row.state === "connected") return "connected";
  if (row.state === "unavailable") return `connection unavailable: ${row.reason ?? "unknown reason"}`;
  return "sign in again";
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON: the status says enough.
  }
  return `HTTP ${res.status}`;
}

async function post(path: string, body: Record<string, unknown> = {}): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

interface SignInReturn {
  connection: string;
  code?: string;
  state?: string;
  error?: string;
}

/** The return {@link captureSignInReturn} took at boot, until the section consumes it. */
let captured: SignInReturn | null = null;

/**
 * A sign-in's return, taken out of the address bar: the connection and code
 * and state, or the authorization server's refusal. Null when this load is
 * not one.
 */
function takeSignInReturn(): SignInReturn | null {
  const params = new URLSearchParams(location.search);
  const connection = params.get(CONNECTION_PARAM);
  if (!connection) return null;
  const found = {
    connection,
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
    error: params.get("error_description") ?? params.get("error") ?? undefined,
  };
  for (const name of RETURN_PARAMS) params.delete(name);
  const base = getBasePath();
  const path = base && location.pathname.startsWith(base) ? location.pathname.slice(base.length) || "/" : location.pathname;
  const rest = params.toString();
  replaceAppHistory(history.state, `${path}${rest ? `?${rest}` : ""}${location.hash}`);
  return found;
}

/**
 * Take a sign-in's return out of the address bar at boot, before the router
 * seeds its history entry: that entry is the view's path alone, so the code
 * and state would be gone by the time the section mounts (it waits on
 * `web.sidecar`). The section finishes the sign-in when it mounts.
 */
export function captureSignInReturn(): void {
  captured = takeSignInReturn() ?? captured;
}

/** The captured return, else one still in the address bar; each is used once. */
function consumeSignInReturn(): SignInReturn | null {
  const returned = captured ?? takeSignInReturn();
  captured = null;
  return returned;
}

export interface ConnectionsSectionProps {
  /** Send this tab to an authorization URL. Defaults to `location.assign` (tests replace it). */
  navigate?: (url: string) => void;
}

const assignLocation = (url: string): void => location.assign(url);

export function ConnectionsSection({ navigate = assignLocation }: ConnectionsSectionProps = {}) {
  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  const [configFile, setConfigFile] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) {
        setLoadError(await readError(res));
        return;
      }
      const body = (await res.json()) as { connections: ConnectionRow[]; configFile?: string };
      setRows(body.connections);
      setConfigFile(body.configFile ?? null);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const replaceRow = useCallback((row: ConnectionRow) => {
    setRows((current) => current?.map((r) => (r.id === row.id ? row : r)) ?? current);
  }, []);

  useEffect(() => {
    const returned = consumeSignInReturn();
    void (async () => {
      if (returned) {
        sectionRef.current?.scrollIntoView?.({ block: "start" });
        if (returned.error || !returned.code || !returned.state) {
          setNotice({ kind: "error", text: `Sign-in to ${returned.connection} was not completed: ${returned.error ?? "no code was returned"}` });
        } else {
          const res = await post(`/api/connections/${encodeURIComponent(returned.connection)}/oauth/finish`, {
            code: returned.code,
            state: returned.state,
          }).catch((err: unknown) => err as Error);
          if (res instanceof Error) setNotice({ kind: "error", text: `Sign-in to ${returned.connection} failed: ${res.message}` });
          else if (!res.ok) setNotice({ kind: "error", text: `Sign-in to ${returned.connection} failed: ${await readError(res)}` });
          else {
            const { connection } = (await res.json()) as { connection: ConnectionRow };
            setNotice({ kind: "ok", text: `Signed in to ${connection.label}: ${connectionStateLabel(connection)}.` });
          }
        }
      }
      await load();
    })();
  }, [load]);

  const signIn = async (row: ConnectionRow) => {
    setBusy(row.id);
    setNotice(null);
    try {
      const redirectUrl = `${location.origin}${appUrl(RETURN_PATH)}?${CONNECTION_PARAM}=${encodeURIComponent(row.id)}`;
      const res = await post(`/api/connections/${encodeURIComponent(row.id)}/oauth/start`, { redirectUrl });
      if (!res.ok) {
        setNotice({ kind: "error", text: `Could not start the sign-in to ${row.label}: ${await readError(res)}` });
        return;
      }
      const { authorizationUrl } = (await res.json()) as { authorizationUrl: string };
      // Same tab: the session credential lives in this tab's sessionStorage.
      navigate(authorizationUrl);
    } catch (err) {
      setNotice({ kind: "error", text: `Could not start the sign-in to ${row.label}: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  };

  const signOut = async (row: ConnectionRow) => {
    setBusy(row.id);
    setNotice(null);
    try {
      const res = await post(`/api/connections/${encodeURIComponent(row.id)}/sign-out`);
      if (!res.ok) {
        setNotice({ kind: "error", text: `Could not sign out of ${row.label}: ${await readError(res)}` });
        return;
      }
      replaceRow(((await res.json()) as { connection: ConnectionRow }).connection);
      setNotice({ kind: "ok", text: `Signed out of ${row.label}.` });
    } catch (err) {
      setNotice({ kind: "error", text: `Could not sign out of ${row.label}: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  };

  return h("div", { ref: sectionRef, class: "connections", id: "connections" },
    h("p", { class: "project-section-note" },
      "Servers the Sidecar can use. Add one under ",
      h("code", null, "connections"),
      " in ",
      // The server names the file: the viewer cannot resolve the layout.
      configFile ? h("code", null, configFile) : "your local config file",
      " and restart the dashboard; they cannot be added here yet.",
    ),
    notice
      ? h("p", { class: `connections-notice connections-notice--${notice.kind}`, role: notice.kind === "error" ? "alert" : "status" }, notice.text)
      : null,
    loadError
      ? h("p", { class: "connections-notice connections-notice--error", role: "alert" }, `Could not read connections: ${loadError}`)
      : null,
    rows === null && !loadError ? h("p", { class: "connections-empty", role: "status" }, "Loading connections…") : null,
    rows && rows.length === 0 ? h("p", { class: "connections-empty" }, "No connections.") : null,
    rows && rows.length > 0
      ? h("ul", { class: "connections-list" },
        rows.map((row) =>
          h("li", { key: row.id, class: "connections-row", "data-connection": row.id },
            h("div", { class: "connections-row-main" },
              h("span", { class: "connections-label" }, row.label),
              h("span", { class: "connections-transport" }, row.transport === "http" ? "HTTP" : "stdio"),
              h("span", { class: `connections-state connections-state--${row.state}` }, connectionStateLabel(row)),
              row.state === "connected"
                ? h("span", { class: "connections-tools" }, `${row.tools} tool${row.tools === 1 ? "" : "s"}`)
                : null,
            ),
            row.state === "needs-sign-in" && row.reason
              ? h("p", { class: "connections-reason" }, row.reason)
              : null,
            row.auth === "oauth"
              ? h("div", { class: "connections-actions" },
                row.state === "connected"
                  ? h("button", { type: "button", class: "connections-button", disabled: busy !== null, onClick: () => signOut(row) }, "Sign out")
                  : h("button", { type: "button", class: "connections-button", disabled: busy !== null, onClick: () => signIn(row) }, "Sign in"),
              )
              : null,
          ),
        ),
      )
      : null,
  );
}
