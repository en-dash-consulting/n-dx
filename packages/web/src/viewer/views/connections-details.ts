/**
 * One connection's details in Settings > Project > Connections: its discovered
 * tools with class and policy (each editable), the server-profile picker with
 * its validation result, and, for a token connection, the field a token is
 * typed into. Every edit goes through the connections routes, which write the
 * untracked local config file (a token goes to the credential store instead);
 * the answer is not held here beyond the field's own value, and is cleared as
 * soon as it is sent.
 */

import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  connectionPath,
  errorText,
  readError,
  send,
  TOOL_CLASSES,
  TOOL_POLICIES,
  type ConnectionRow,
  type ConnectionProfile,
  type ReportNotice,
  type ToolRow,
} from "./connections-api.js";

/** The profile's validation as one line. */
export function profileLine(profile: ConnectionProfile): string {
  if (profile.state === "ok") return `Profile ${profile.name} fits this server.`;
  if (profile.state === "invalid") return `Profile ${profile.name} does not fit this server: ${profile.problem ?? "unknown problem"}. It is not used.`;
  return `Profile ${profile.name} is checked once the server's tools are listed.`;
}

/** The tools of a server, with class and policy. Editable when `onEdit` is given. */
export function ToolsTable({ tools, onEdit }: { tools: readonly ToolRow[]; onEdit?: (tool: ToolRow, patch: Record<string, unknown>) => void }) {
  if (tools.length === 0) return h("p", { class: "connections-empty" }, "The server lists no tools.");
  return h("table", { class: "connections-tools-table" },
    h("thead", null,
      h("tr", null, ["Tool", "Class", "Policy", ""].map((title) => h("th", { key: title, scope: "col" }, title))),
    ),
    h("tbody", null,
      tools.map((tool) =>
        h("tr", { key: tool.tool, "data-tool": tool.tool },
          h("td", { class: "connections-tool-name", title: tool.description || undefined }, tool.tool),
          h("td", null,
            onEdit
              ? h("select", {
                "aria-label": `Class of ${tool.tool}`,
                class: "connections-select",
                value: tool.class,
                onChange: (event: Event) => onEdit(tool, { class: (event.target as HTMLSelectElement).value }),
              }, TOOL_CLASSES.map((value) => h("option", { key: value, value }, value)))
              : tool.class,
          ),
          h("td", null,
            onEdit
              ? h("select", {
                "aria-label": `Policy of ${tool.tool}`,
                class: "connections-select",
                value: tool.policy,
                onChange: (event: Event) => onEdit(tool, { policy: (event.target as HTMLSelectElement).value }),
              }, TOOL_POLICIES.map((value) => h("option", { key: value, value }, value)))
              : tool.policy,
          ),
          h("td", { class: "connections-tool-source" },
            onEdit && (tool.classSource === "override" || tool.policySource === "override")
              ? h("button", {
                type: "button",
                class: "connections-button connections-button--quiet",
                onClick: () => onEdit(tool, { class: null, policy: null }),
              }, "Reset")
              : null,
          ),
        ),
      ),
    ),
  );
}

export interface ConnectionDetailsProps {
  row: ConnectionRow;
  onNotice: ReportNotice;
  /** The connection as a route answered it after an edit. */
  onChanged: (row: ConnectionRow) => void;
}

export function ConnectionDetails({ row, onNotice, onChanged }: ConnectionDetailsProps) {
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const base = connectionPath(row.id);
  // The row and callbacks change with every answer; a reload follows the connection's id alone.
  const latest = useRef({ row, onNotice, onChanged });
  latest.current = { row, onNotice, onChanged };

  const loadTools = useCallback(async () => {
    const { row: current, onNotice: notify, onChanged: changed } = latest.current;
    try {
      const res = await fetch(`${base}/tools`);
      if (!res.ok) {
        notify({ kind: "error", text: `Could not list the tools of ${current.label}: ${await readError(res)}` });
        return;
      }
      const body = (await res.json()) as { connection: ConnectionRow; tools: ToolRow[] };
      setTools(body.tools);
      changed(body.connection);
    } catch (err) {
      notify({ kind: "error", text: `Could not list the tools of ${current.label}: ${errorText(err)}` });
    }
  }, [base]);

  useEffect(() => {
    void loadTools();
    void (async () => {
      try {
        const res = await fetch("/api/connections/profiles");
        if (res.ok) setProfiles(((await res.json()) as { profiles: string[] }).profiles);
      } catch {
        // The picker offers "none" and the current profile without the list.
      }
    })();
  }, [loadTools]);

  const editTool = async (tool: ToolRow, patch: Record<string, unknown>) => {
    onNotice(null);
    try {
      const res = await send("PUT", `${base}/tools/${encodeURIComponent(tool.tool)}`, patch);
      if (!res.ok) {
        onNotice({ kind: "error", text: `Could not change ${tool.tool}: ${await readError(res)}` });
        return;
      }
      const { tool: changed } = (await res.json()) as { tool: ToolRow };
      setTools((current) => current?.map((t) => (t.tool === changed.tool ? { ...t, ...changed } : t)) ?? current);
    } catch (err) {
      onNotice({ kind: "error", text: `Could not change ${tool.tool}: ${errorText(err)}` });
    }
  };

  const chooseProfile = async (profile: string) => {
    setBusy(true);
    onNotice(null);
    try {
      const res = await send("PUT", `${base}/profile`, { profile: profile === "" ? null : profile });
      if (!res.ok) {
        onNotice({ kind: "error", text: `Could not set the profile of ${row.label}: ${await readError(res)}` });
        return;
      }
      onChanged(((await res.json()) as { connection: ConnectionRow }).connection);
    } catch (err) {
      onNotice({ kind: "error", text: `Could not set the profile of ${row.label}: ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const saveToken = async (event: Event) => {
    event.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    onNotice(null);
    try {
      const res = await send("PUT", `${base}/token`, { token });
      // Gone from the page whether or not it was accepted: the field is not a draft.
      setToken("");
      if (!res.ok) {
        onNotice({ kind: "error", text: `Could not store the token for ${row.label}: ${await readError(res)}` });
        return;
      }
      onChanged(((await res.json()) as { connection: ConnectionRow }).connection);
      onNotice({ kind: "ok", text: `Stored the token for ${row.label}.` });
      await loadTools();
    } catch (err) {
      setToken("");
      onNotice({ kind: "error", text: `Could not store the token for ${row.label}: ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const profileNames = row.profile && !profiles.includes(row.profile.name) ? [...profiles, row.profile.name] : profiles;

  return h("div", { class: "connections-details" },
    row.auth === "token"
      ? h("form", { class: "connections-field-row", onSubmit: saveToken },
        h("label", { class: "connections-field-label", for: `connection-token-${row.id}` }, "Token"),
        h("input", {
          id: `connection-token-${row.id}`,
          class: "connections-input",
          type: "password",
          autoComplete: "off",
          placeholder: row.tokenStored ? "Stored — type to replace" : "Paste the token",
          value: token,
          onInput: (event: Event) => setToken((event.target as HTMLInputElement).value),
        }),
        h("button", { type: "submit", class: "connections-button", disabled: busy || !token.trim() }, "Save token"),
        h("span", { class: "connections-hint" }, row.tokenStored ? "A token is stored." : "No token is stored."),
      )
      : null,
    h("div", { class: "connections-field-row" },
      h("label", { class: "connections-field-label", for: `connection-profile-${row.id}` }, "Server profile"),
      h("select", {
        id: `connection-profile-${row.id}`,
        class: "connections-select",
        value: row.profile?.name ?? "",
        disabled: busy,
        onChange: (event: Event) => void chooseProfile((event.target as HTMLSelectElement).value),
      },
      h("option", { value: "" }, "None"),
      profileNames.map((name) => h("option", { key: name, value: name }, name)),
      ),
      row.profile
        ? h("span", { class: `connections-hint connections-profile connections-profile--${row.profile.state}`, role: "status" }, profileLine(row.profile))
        : null,
    ),
    tools === null
      ? h("p", { class: "connections-empty", role: "status" }, "Listing tools…")
      : h(ToolsTable, { tools, onEdit: (tool, patch) => void editTool(tool, patch) }),
  );
}
