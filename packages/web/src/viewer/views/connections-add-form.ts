/**
 * The add-server form of Settings > Project > Connections: an HTTP server (a
 * URL) or a stdio server (a command, its arguments, the environment variables
 * it needs), with auth none, token or OAuth. Add saves it to the untracked
 * local config file; a token typed here goes to the credential store and is
 * cleared from the form once sent. Test connects the server as described,
 * lists its tools and saves nothing (a token or OAuth server is tested once
 * added, because its credential is not stored yet).
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import { ToolsTable } from "./connections-details.js";
import { errorText, readError, send, type ConnectionRow, type ReportNotice, type ToolRow } from "./connections-api.js";

type Transport = "http" | "stdio";
type Auth = "none" | "token" | "oauth";

interface TestResult {
  state: "connected" | "unavailable" | "needs-sign-in";
  reason?: string;
  tools: ToolRow[];
}

interface FormValues {
  id: string;
  label: string;
  transport: Transport;
  url: string;
  command: string;
  args: string;
  env: string;
  auth: Auth;
}

const EMPTY: FormValues = { id: "", label: "", transport: "http", url: "", command: "", args: "", env: "", auth: "none" };

/** `NAME=value` lines as a map, or the line that is not one. */
export function parseEnvLines(text: string): Record<string, string> | { bad: string } {
  const env: Record<string, string> = {};
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const at = line.indexOf("=");
    if (at <= 0) return { bad: line };
    env[line.slice(0, at).trim()] = line.slice(at + 1);
  }
  return env;
}

/** The request body the values describe (no token), or what is wrong with them. */
export function connectionBody(values: FormValues): Record<string, unknown> | string {
  const id = values.id.trim();
  if (!id) return "Give the connection an id: lowercase letters, digits and dashes, starting with a letter.";
  const common = { id, ...(values.label.trim() && { label: values.label.trim() }), transport: values.transport };
  if (values.transport === "http") {
    if (!values.url.trim()) return "Give the server's URL.";
    return { ...common, url: values.url.trim(), auth: values.auth };
  }
  if (!values.command.trim()) return "Give the command that starts the server.";
  const env = parseEnvLines(values.env);
  if ("bad" in env) return `Environment lines look like NAME=value; "${env.bad}" does not.`;
  const args = values.args.split("\n").map((arg) => arg.trim()).filter(Boolean);
  return { ...common, command: values.command.trim(), args, env, auth: "none" };
}

export interface AddConnectionFormProps {
  onAdded: (row: ConnectionRow) => void;
  onNotice: ReportNotice;
}

export function AddConnectionForm({ onAdded, onNotice }: AddConnectionFormProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tested, setTested] = useState<TestResult | null>(null);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setTested(null);
  };
  const field = (key: "id" | "label" | "url" | "command", label: string, hint?: string) =>
    h("div", { class: "connections-field-row" },
      h("label", { class: "connections-field-label", for: `connection-add-${key}` }, label),
      h("input", {
        id: `connection-add-${key}`,
        class: "connections-input",
        type: "text",
        autoComplete: "off",
        spellcheck: false,
        value: values[key],
        onInput: (event: Event) => set(key, (event.target as HTMLInputElement).value),
      }),
      hint ? h("span", { class: "connections-hint" }, hint) : null,
    );
  const lines = (key: "args" | "env", label: string, hint: string) =>
    h("div", { class: "connections-field-row" },
      h("label", { class: "connections-field-label", for: `connection-add-${key}` }, label),
      h("textarea", {
        id: `connection-add-${key}`,
        class: "connections-input connections-textarea",
        rows: 3,
        spellcheck: false,
        value: values[key],
        onInput: (event: Event) => set(key, (event.target as HTMLTextAreaElement).value),
      }),
      h("span", { class: "connections-hint" }, hint),
    );

  const close = () => {
    setOpen(false);
    setValues(EMPTY);
    setToken("");
    setProblem(null);
    setTested(null);
  };

  const test = async () => {
    const body = connectionBody(values);
    if (typeof body === "string") {
      setProblem(body);
      return;
    }
    setProblem(null);
    setBusy(true);
    setTested(null);
    try {
      const res = await send("POST", "/api/connections/test", body);
      if (!res.ok) setProblem(await readError(res));
      else setTested((await res.json()) as TestResult);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: Event) => {
    event.preventDefault();
    const body = connectionBody(values);
    if (typeof body === "string") {
      setProblem(body);
      return;
    }
    setProblem(null);
    setBusy(true);
    onNotice(null);
    try {
      const res = await send("POST", "/api/connections", { ...body, ...(values.auth === "token" && token.trim() ? { token } : {}) });
      // The token is sent: it does not stay in the field.
      setToken("");
      if (!res.ok) {
        setProblem(await readError(res));
        return;
      }
      const { connection } = (await res.json()) as { connection: ConnectionRow };
      onAdded(connection);
      onNotice({ kind: "ok", text: `Added ${connection.label}.` });
      close();
    } catch (err) {
      setToken("");
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return h("div", { class: "connections-add" },
      h("button", { type: "button", class: "connections-button", onClick: () => setOpen(true) }, "Add connection"),
    );
  }

  const canTest = values.transport === "stdio" || values.auth === "none";

  return h("form", { class: "connections-add connections-add--open", onSubmit: add, "aria-label": "Add connection" },
    field("id", "Id", "Becomes the tool prefix, e.g. docs.read_item."),
    field("label", "Label", "Optional; what you call it."),
    h("div", { class: "connections-field-row" },
      h("span", { class: "connections-field-label" }, "Transport"),
      h("label", { class: "connections-radio" },
        h("input", { type: "radio", name: "connection-transport", checked: values.transport === "http", onChange: () => setValues((c) => ({ ...c, transport: "http" })) }),
        " HTTP",
      ),
      h("label", { class: "connections-radio" },
        h("input", { type: "radio", name: "connection-transport", checked: values.transport === "stdio", onChange: () => setValues((c) => ({ ...c, transport: "stdio", auth: "none" })) }),
        " stdio",
      ),
    ),
    values.transport === "http"
      ? [
        field("url", "URL"),
        h("div", { key: "auth", class: "connections-field-row" },
          h("label", { class: "connections-field-label", for: "connection-add-auth" }, "Auth"),
          h("select", {
            id: "connection-add-auth",
            class: "connections-select",
            value: values.auth,
            onChange: (event: Event) => set("auth", (event.target as HTMLSelectElement).value as Auth),
          },
          h("option", { value: "none" }, "None"),
          h("option", { value: "token" }, "Token"),
          h("option", { value: "oauth" }, "OAuth (sign in)"),
          ),
        ),
        values.auth === "token"
          ? h("div", { key: "token", class: "connections-field-row" },
            h("label", { class: "connections-field-label", for: "connection-add-token" }, "Token"),
            h("input", {
              id: "connection-add-token",
              class: "connections-input",
              type: "password",
              autoComplete: "off",
              value: token,
              onInput: (event: Event) => setToken((event.target as HTMLInputElement).value),
            }),
            h("span", { class: "connections-hint" }, "Kept in your credential store, never in a project file."),
          )
          : null,
      ]
      : [
        field("command", "Command"),
        lines("args", "Arguments", "One per line."),
        lines("env", "Environment", "NAME=value, one per line. Written to your local config as typed."),
      ],
    problem ? h("p", { class: "connections-notice connections-notice--error", role: "alert" }, problem) : null,
    tested
      ? h("div", { class: "connections-test-result", role: "status" },
        h("p", { class: `connections-state connections-state--${tested.state}` },
          tested.state === "connected"
            ? `Connected: ${tested.tools.length} tool${tested.tools.length === 1 ? "" : "s"}.`
            : `Not connected: ${tested.reason ?? tested.state}`),
        tested.state === "connected" ? h(ToolsTable, { tools: tested.tools }) : null,
      )
      : null,
    h("div", { class: "connections-actions" },
      h("button", {
        type: "button",
        class: "connections-button",
        disabled: busy || !canTest,
        title: canTest ? undefined : "Add the connection first, then test it: its credential is stored when it is added.",
        onClick: () => void test(),
      }, "Test"),
      h("button", { type: "submit", class: "connections-button connections-button--primary", disabled: busy }, "Add"),
      h("button", { type: "button", class: "connections-button connections-button--quiet", disabled: busy, onClick: close }, "Cancel"),
    ),
  );
}
