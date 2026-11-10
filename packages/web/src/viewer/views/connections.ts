/**
 * Connections — the section of Settings > Project that manages the MCP servers
 * the operator connected (`connections` in the local config file, whose name
 * the server sends): their state, an add form (connections-add-form.ts), Test,
 * Remove, each server's tools, profile and token (connections-details.ts), and
 * the tracker sync rules (connections-sync.ts). Every change is saved at once
 * by its own route to the untracked local config file, so it never makes the
 * page dirty. Shown only while `web.sidecar` is on; the Project page decides.
 *
 * Sign-in goes through this page and nothing else. Sign in asks the server
 * for an authorization URL that returns to the fixed loopback callback,
 * `<origin>/oauth/callback`, with a state naming this page's project,
 * worktree and the connection, and the tab goes there. The authorization
 * server sends the tab back with `code`, `state` and `iss` (through the hub,
 * the hub forwards it to `/p/<project>/oauth/callback`); the page takes them
 * out of the address bar at once, goes to Settings > Project and posts them
 * to `/api/connections/:id/oauth/finish` with the tab's session credential in
 * the header (the session script's fetch), so the server never acts on a
 * credential in a URL. The result shows above the list.
 */

import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { getBasePath, getWorkspaceKey, replaceAppHistory } from "../base-path.js";
import { OAUTH_CALLBACK_PATH, detectBasePath, parseSignInState } from "../external.js";
import { AddConnectionForm } from "./connections-add-form.js";
import {
  connectionPath,
  connectionStateLabel,
  errorText,
  readError,
  send,
  type ConnectionRow,
  type Notice,
  type ToolRow,
} from "./connections-api.js";
import { ConnectionDetails } from "./connections-details.js";
import { SyncRulesSection } from "./connections-sync.js";

export { connectionStateLabel };
export type { ConnectionRow };

/** The page a sign-in finishes on: Settings > Project. */
const RETURN_PATH = "/project";

const post = (path: string, body: Record<string, unknown> = {}): Promise<Response> => send("POST", path, body);

interface SignInReturn {
  /** Unset when the state names none: a return this dashboard did not start. */
  connection?: string;
  code?: string;
  state?: string;
  iss?: string;
  error?: string;
}

/** The return {@link captureSignInReturn} took at boot, until the section consumes it. */
let captured: SignInReturn | null = null;

/** This load's path below the base path. */
function appPath(): string {
  const base = getBasePath();
  return base && location.pathname.startsWith(base) ? location.pathname.slice(base.length) || "/" : location.pathname;
}

/**
 * A sign-in's return, taken out of the address bar of the callback page: the
 * connection its state names and the code, state and iss, or the
 * authorization server's refusal. The address becomes Settings > Project.
 * Null when this load is not one, or when it belongs to another worktree's
 * dashboard, which `replace` sends the tab to with the query intact.
 */
function takeSignInReturn(replace: (url: string) => void): SignInReturn | null {
  if (appPath() !== OAUTH_CALLBACK_PATH) return null;
  const params = new URLSearchParams(location.search);
  const state = params.get("state") ?? undefined;
  const routed = parseSignInState(state);
  // The hub forwards to the project; the worktree is this page's to reach.
  const workspace = routed?.workspace ?? null;
  if (routed && workspace !== getWorkspaceKey()) {
    const slot = workspace ? `/w/${encodeURIComponent(workspace)}` : "";
    replace(`${detectBasePath(getBasePath())}${slot}${OAUTH_CALLBACK_PATH}${location.search}`);
    return null;
  }
  replaceAppHistory(history.state, RETURN_PATH);
  return {
    connection: routed?.connection,
    code: params.get("code") ?? undefined,
    state,
    iss: params.get("iss") ?? undefined,
    error: params.get("error_description") ?? params.get("error") ?? undefined,
  };
}

/**
 * Take a sign-in's return out of the callback page's address at boot, before
 * the router seeds its history entry, and leave the tab on Settings >
 * Project: the code and state would otherwise be gone by the time the section
 * mounts (it waits on `web.sidecar`). The section finishes the sign-in when
 * it mounts. `replace` defaults to `location.replace` (tests replace it).
 */
export function captureSignInReturn(replace: (url: string) => void = (url) => location.replace(url)): void {
  captured = takeSignInReturn(replace) ?? captured;
}

/** The captured return, else one still in the address bar; each is used once. */
function consumeSignInReturn(): SignInReturn | null {
  const returned = captured ?? takeSignInReturn((url) => location.replace(url));
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
  /** The connection whose tools, profile and token are open. */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** The connection asking to be removed, and whether its stored credential goes too. */
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleteCredential, setDeleteCredential] = useState(false);
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
        const name = returned.connection ?? "the connection";
        if (returned.error || !returned.code || !returned.state || !returned.connection) {
          const why = returned.error ?? (returned.connection ? "no code was returned" : "the return does not name a sign-in started here");
          setNotice({ kind: "error", text: `Sign-in to ${name} was not completed: ${why}` });
        } else {
          const res = await post(`/api/connections/${encodeURIComponent(returned.connection)}/oauth/finish`, {
            code: returned.code,
            state: returned.state,
            ...(returned.iss !== undefined && { iss: returned.iss }),
          }).catch((err: unknown) => err as Error);
          if (res instanceof Error) setNotice({ kind: "error", text: `Sign-in to ${name} failed: ${res.message}` });
          else if (!res.ok) setNotice({ kind: "error", text: `Sign-in to ${name} failed: ${await readError(res)}` });
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
      // The fixed callback at this origin's root: through the hub, the hub relays it to the project.
      const redirectUrl = `${location.origin}${OAUTH_CALLBACK_PATH}`;
      const res = await post(`/api/connections/${encodeURIComponent(row.id)}/oauth/start`, { redirectUrl, basePath: getBasePath() });
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

  const testRow = async (row: ConnectionRow) => {
    setBusy(row.id);
    setNotice(null);
    try {
      const res = await post(`${connectionPath(row.id)}/test`);
      if (!res.ok) {
        setNotice({ kind: "error", text: `Could not test ${row.label}: ${await readError(res)}` });
        return;
      }
      const { connection, tools } = (await res.json()) as { connection: ConnectionRow; tools: ToolRow[] };
      replaceRow(connection);
      setNotice(connection.state === "connected"
        ? { kind: "ok", text: `${connection.label} is connected: ${tools.length} tool${tools.length === 1 ? "" : "s"}.` }
        : { kind: "error", text: `${connection.label}: ${connectionStateLabel(connection)}` });
    } catch (err) {
      setNotice({ kind: "error", text: `Could not test ${row.label}: ${errorText(err)}` });
    } finally {
      setBusy(null);
    }
  };

  const removeRow = async (row: ConnectionRow) => {
    setBusy(row.id);
    setNotice(null);
    try {
      const res = await send("DELETE", `${connectionPath(row.id)}${deleteCredential ? "?credential=delete" : ""}`);
      if (!res.ok) {
        setNotice({ kind: "error", text: `Could not remove ${row.label}: ${await readError(res)}` });
        return;
      }
      setRows((current) => current?.filter((r) => r.id !== row.id) ?? current);
      setExpanded((current) => (current === row.id ? null : current));
      setRemoving(null);
      setNotice({ kind: "ok", text: `Removed ${row.label}${deleteCredential ? " and its stored token" : ""}.` });
    } catch (err) {
      setNotice({ kind: "error", text: `Could not remove ${row.label}: ${errorText(err)}` });
    } finally {
      setBusy(null);
    }
  };

  const added = (row: ConnectionRow) => {
    setRows((current) => [...(current ?? []).filter((r) => r.id !== row.id), row]);
    setExpanded(row.id);
  };

  return h("div", { ref: sectionRef, class: "connections", id: "connections" },
    h("p", { class: "project-section-note" },
      "Servers the Sidecar can use. Changes here are saved at once to ",
      // The server names the file: the viewer cannot resolve the layout.
      configFile ? h("code", null, configFile) : "your local config file",
      ", never the tracked config, and a token goes to your credential store.",
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
            h("div", { class: "connections-actions" },
              row.auth === "oauth"
                ? row.state === "connected"
                  ? h("button", { type: "button", class: "connections-button", disabled: busy !== null, onClick: () => signOut(row) }, "Sign out")
                  : h("button", { type: "button", class: "connections-button", disabled: busy !== null, onClick: () => signIn(row) }, "Sign in")
                : null,
              h("button", { type: "button", class: "connections-button", disabled: busy !== null, onClick: () => testRow(row) }, "Test"),
              h("button", {
                type: "button",
                class: "connections-button",
                "aria-expanded": expanded === row.id,
                onClick: () => setExpanded(expanded === row.id ? null : row.id),
              }, expanded === row.id ? "Hide details" : "Details"),
              h("button", {
                type: "button",
                class: "connections-button connections-button--quiet",
                disabled: busy !== null,
                onClick: () => { setRemoving(row.id); setDeleteCredential(false); },
              }, "Remove"),
            ),
            removing === row.id
              ? h("div", { class: "connections-remove", role: "group", "aria-label": `Remove ${row.label}` },
                h("p", { class: "connections-reason" }, `Remove ${row.label} from your local config? Its tools leave the Sidecar at once.`),
                row.auth !== "none"
                  ? h("label", { class: "connections-radio" },
                    h("input", {
                      type: "checkbox",
                      checked: deleteCredential,
                      onChange: (event: Event) => setDeleteCredential((event.target as HTMLInputElement).checked),
                    }),
                    ` Also delete the stored credential (connection:${row.id})`,
                  )
                  : null,
                h("div", { class: "connections-actions" },
                  h("button", { type: "button", class: "connections-button connections-button--danger", disabled: busy !== null, onClick: () => removeRow(row) }, "Remove connection"),
                  h("button", { type: "button", class: "connections-button connections-button--quiet", onClick: () => setRemoving(null) }, "Cancel"),
                ),
              )
              : null,
            expanded === row.id
              ? h(ConnectionDetails, { row, onNotice: setNotice, onChanged: replaceRow })
              : null,
          ),
        ),
      )
      : null,
    h(AddConnectionForm, { onAdded: added, onNotice: setNotice }),
    h(SyncRulesSection, { connectionIds: (rows ?? []).map((row) => row.id), onNotice: setNotice }),
  );
}
