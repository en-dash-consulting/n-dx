/**
 * The body of an external-call card (Sidecar connections): a form drawn from
 * the tool's JSON input schema, prefilled with the agent's arguments and
 * editable while the card waits; Approve sends the edited arguments.
 *
 * A property is drawn by its schema: string, number, integer, boolean, enum,
 * a list of scalars (one per line) or an object one level deep (a group of
 * those). Anything else (a union, a list of objects, a deeper object, no
 * type) and any argument the schema does not name is a JSON field for that
 * property alone. A property the card carries picker choices for
 * (`externalCall.options`, read from the connection's own tools by its field
 * hints) is a picker; with none it is the plain field. An idempotency key
 * (`requestId` or `idempotencyKey`) is shown read-only in the header: the
 * server keeps the agent's value whatever is sent.
 *
 * The form's logic is plain functions over plain values so it is tested
 * without a DOM; the components only draw it.
 */

import { h, type ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import type { SidecarCallProblem, SidecarExternalCall, SidecarFieldOption } from "../hooks/sidecar.js";

type Json = Record<string, unknown>;

/** The properties whose value an approval cannot change; mirrors `IDEMPOTENCY_KEY_PROPERTIES` in the server's external-call.ts. */
const IDEMPOTENCY_KEY_PROPERTIES = ["requestId", "idempotencyKey"] as const;

const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

export type ScalarType = "string" | "number" | "integer" | "boolean";

/** How one property is drawn. */
export type FieldKind =
  | { kind: "scalar"; type: ScalarType }
  | { kind: "enum"; values: Array<string | number | boolean> }
  | { kind: "list"; item: ScalarType }
  | { kind: "object"; properties: Json; required: string[] }
  | { kind: "json" };

const SCALAR_TYPES: readonly string[] = ["string", "number", "integer", "boolean"];
const isScalarType = (value: unknown): value is ScalarType => typeof value === "string" && SCALAR_TYPES.includes(value);

/** How `schema` is drawn; an object is a group only at the top level (`nested` false). */
export function fieldKind(schema: unknown, nested = false): FieldKind {
  if (!isRecord(schema)) return { kind: "json" };
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(isScalar)) {
    return { kind: "enum", values: schema.enum as Array<string | number | boolean> };
  }
  if (isScalarType(schema.type)) return { kind: "scalar", type: schema.type };
  if (schema.type === "array" && isRecord(schema.items) && isScalarType(schema.items.type) && schema.items.enum === undefined) {
    return { kind: "list", item: schema.items.type };
  }
  if (schema.type === "object" && !nested && isRecord(schema.properties)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : [];
    return { kind: "object", properties: schema.properties, required };
  }
  return { kind: "json" };
}

/** The top-level properties of a schema: its own, in order, then any argument it does not name. */
export function formFields(schema: Json, args: Json): Array<{ name: string; schema: unknown; required: boolean }> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : []);
  const named = Object.keys(properties).map((name) => ({ name, schema: properties[name], required: required.has(name) }));
  const extra = Object.keys(args).filter((name) => !(name in properties)).map((name) => ({ name, schema: undefined, required: false }));
  return [...named, ...extra].filter((f) => !(IDEMPOTENCY_KEY_PROPERTIES as readonly string[]).includes(f.name));
}

/** The idempotency key the agent's arguments carry, shown read-only. */
export function idempotencyKey(args: Json): { name: string; value: string } | undefined {
  for (const name of IDEMPOTENCY_KEY_PROPERTIES) {
    if (isScalar(args[name])) return { name, value: String(args[name]) };
  }
  return undefined;
}

/** "CAOS · caos.endash.us": the connection and the workspace host it reaches; the label alone for a stdio server. */
export function workspaceLine(call: Pick<SidecarExternalCall, "label" | "host">): string {
  return call.host ? `${call.label} · ${call.host}` : call.label;
}

/** `text` as a number; undefined when empty, null when it is not one (or not whole for an integer). */
export function parseNumber(text: string, type: "number" | "integer"): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || (type === "integer" && !Number.isInteger(n))) return null;
  return n;
}

/** A list field's lines as values of `item`'s type; null when a line is not one. Empty lines are dropped. */
export function parseList(text: string, item: ScalarType): unknown[] | null {
  const out: unknown[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (item === "string") out.push(line);
    else if (item === "boolean") {
      if (line !== "true" && line !== "false") return null;
      out.push(line === "true");
    } else {
      const n = parseNumber(line, item);
      if (n === null || n === undefined) return null;
      out.push(n);
    }
  }
  return out;
}

/** A JSON field's text as a value; `{ ok: false }` when it does not parse. Empty text clears the property. */
export function parseJsonField(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** `args` with `name` set, or removed when `value` is undefined. */
function withProperty(args: Json, name: string, value: unknown): Json {
  const next = { ...args };
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next;
}

// ── Components ───────────────────────────────────────────────────────

interface FieldProps {
  /** Dotted path, the key validity is reported under. */
  path: string;
  name: string;
  schema: unknown;
  required: boolean;
  value: unknown;
  options?: readonly SidecarFieldOption[];
  /** `undefined` removes the property. */
  onChange: (value: unknown) => void;
  /** Whether the text in the field is a value of its type. */
  onValidity: (path: string, ok: boolean) => void;
  nested: boolean;
}

function FieldLabel({ name, required, schema }: { name: string; required: boolean; schema: unknown }) {
  const description = isRecord(schema) && typeof schema.description === "string" ? schema.description : "";
  return h("span", { class: "sidecar-external-label", title: description || undefined },
    name,
    required ? h("span", { class: "sidecar-external-required", title: "Required", "aria-hidden": "true" }, " *") : null,
  );
}

/** A picker over `options`; the agent's own value stays a choice when the list does not hold it. */
function Picker({ path, name, required, value, options, onChange }: Pick<FieldProps, "path" | "name" | "required" | "value" | "onChange"> & { options: readonly SidecarFieldOption[] }) {
  const choices = isScalar(value) && !options.some((o) => o.value === value)
    ? [{ value, label: String(value) }, ...options]
    : options;
  return h("select", {
    class: "sidecar-external-input sidecar-external-picker",
    "aria-label": name,
    "aria-required": required ? "true" : undefined,
    "data-field": path,
    value: isScalar(value) ? String(value) : "",
    onChange: (e: Event) => {
      const picked = choices.find((o) => String(o.value) === (e.target as HTMLSelectElement).value);
      onChange(picked?.value);
    },
  },
    required ? null : h("option", { value: "" }, "—"),
    choices.map((o) => h("option", { value: String(o.value), key: String(o.value) }, o.label)),
  );
}

function Field(props: FieldProps) {
  const { path, name, schema, required, value, options, onChange, onValidity, nested } = props;
  const kind = fieldKind(schema, nested);
  const [raw, setRaw] = useState(() => {
    if (kind.kind === "scalar" && (kind.type === "number" || kind.type === "integer")) return value === undefined ? "" : String(value);
    if (kind.kind === "list") return Array.isArray(value) ? value.map(String).join("\n") : "";
    if (kind.kind === "json") return value === undefined ? "" : JSON.stringify(value, null, 2);
    return "";
  });
  const common = { "aria-label": name, "aria-required": required ? "true" : undefined, "data-field": path };
  const label = (control: ComponentChildren) => h("label", { class: "sidecar-external-field", "data-kind": kind.kind }, h(FieldLabel, { name, required, schema }), control);
  const pickable = kind.kind === "scalar" || kind.kind === "enum";

  if (pickable && options && options.length > 0) {
    return label(h(Picker, { path, name, required, value, options, onChange }));
  }
  switch (kind.kind) {
    case "enum":
      return label(h("select", {
        class: "sidecar-external-input", ...common, value: isScalar(value) ? String(value) : "",
        onChange: (e: Event) => onChange(kind.values.find((v) => String(v) === (e.target as HTMLSelectElement).value)),
      },
        required ? null : h("option", { value: "" }, "—"),
        kind.values.map((v) => h("option", { value: String(v), key: String(v) }, String(v))),
      ));
    case "scalar": {
      if (kind.type === "boolean") {
        return h("label", { class: "sidecar-external-field sidecar-external-check", "data-kind": "boolean" },
          h("input", { type: "checkbox", ...common, checked: value === true, onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
          h(FieldLabel, { name, required, schema }));
      }
      if (kind.type === "string") {
        return label(h("input", {
          type: "text", class: "sidecar-external-input", ...common, value: typeof value === "string" ? value : "",
          onInput: (e: Event) => onChange((e.target as HTMLInputElement).value),
        }));
      }
      const type = kind.type;
      return label(h("input", {
        type: "text", inputMode: "decimal", class: "sidecar-external-input", ...common, value: raw,
        "aria-invalid": parseNumber(raw, type) === null ? "true" : undefined,
        onInput: (e: Event) => {
          const text = (e.target as HTMLInputElement).value;
          setRaw(text);
          const n = parseNumber(text, type);
          onValidity(path, n !== null);
          if (n !== null) onChange(n);
        },
      }));
    }
    case "list": {
      const item = kind.item;
      return label(h("textarea", {
        class: "sidecar-external-input", ...common, rows: 3, value: raw, placeholder: `One ${item} per line`,
        "aria-invalid": parseList(raw, item) === null ? "true" : undefined,
        onInput: (e: Event) => {
          const text = (e.target as HTMLTextAreaElement).value;
          setRaw(text);
          const items = parseList(text, item);
          onValidity(path, items !== null);
          if (items !== null) onChange(items.length > 0 || required ? items : undefined);
        },
      }));
    }
    case "object": {
      const group = isRecord(value) ? value : {};
      return h("fieldset", { class: "sidecar-external-group", "data-field": path },
        h("legend", null, h(FieldLabel, { name, required, schema })),
        Object.keys(kind.properties).map((child) => h(Field, {
          key: child,
          path: `${path}.${child}`,
          name: child,
          schema: kind.properties[child],
          required: kind.required.includes(child),
          value: group[child],
          onChange: (v: unknown) => {
            const next = withProperty(group, child, v);
            onChange(Object.keys(next).length > 0 || required ? next : undefined);
          },
          onValidity,
          nested: true,
        })),
      );
    }
    case "json":
      return label(h("textarea", {
        class: "sidecar-external-input sidecar-external-json", ...common, rows: 4, value: raw, spellcheck: false,
        "aria-invalid": parseJsonField(raw).ok ? undefined : "true",
        onInput: (e: Event) => {
          const text = (e.target as HTMLTextAreaElement).value;
          setRaw(text);
          const parsed = parseJsonField(text);
          onValidity(path, parsed.ok);
          if (parsed.ok) onChange(parsed.value);
        },
      }));
  }
}

/** What the card reports as the operator edits: the arguments to send, or null while a field's text is not a value. */
export type ExternalCallEdit = Json | null;

export interface ExternalCallBodyProps {
  call: SidecarExternalCall;
  /** The agent's arguments, which the form starts from. */
  args: Json;
  /** The first waiting card: its fields are editable. */
  editable: boolean;
  onEdit: (edit: ExternalCallEdit) => void;
}

/** The form while the card waits; the arguments as sent, read-only, once it is decided. */
export function ExternalCallBody({ call, args, editable, onEdit }: ExternalCallBodyProps) {
  // Refs, because one input event reports a field's validity and its value back to back.
  const valuesRef = useRef<Json>(args);
  const invalidRef = useRef<Set<string>>(new Set());
  const [, redraw] = useState(0);
  const key = idempotencyKey(args);

  const report = (): void => {
    onEdit(invalidRef.current.size > 0 ? null : valuesRef.current);
    redraw((n) => n + 1);
  };
  const change = (name: string, value: unknown): void => {
    valuesRef.current = withProperty(valuesRef.current, name, value);
    report();
  };
  const validity = (path: string, ok: boolean): void => {
    if (ok) invalidRef.current.delete(path);
    else invalidRef.current.add(path);
    report();
  };
  const values = valuesRef.current;

  return h("div", { class: "sidecar-external-call" },
    h("p", { class: "sidecar-external-workspace", "aria-label": "Workspace" }, workspaceLine(call)),
    key
      ? h("p", { class: "sidecar-external-key" },
          h("span", { class: "sidecar-external-label" }, key.name),
          h("code", { class: "sidecar-external-key-value", "aria-label": `${key.name} (read-only)` }, key.value))
      : null,
    editable
      ? h("div", { class: "sidecar-external-form" },
          formFields(call.inputSchema, args).map((f) => h(Field, {
            key: f.name,
            path: f.name,
            name: f.name,
            schema: f.schema,
            required: f.required,
            value: values[f.name],
            options: call.options?.[f.name],
            onChange: (v: unknown) => change(f.name, v),
            onValidity: validity,
            nested: false,
          })))
      : null,
  );
}

/** The problems list of a validation error, as the server returned it; null when it listed none. */
export function ProblemList({ problems }: { problems: readonly SidecarCallProblem[] | undefined }) {
  if (!problems || problems.length === 0) return null;
  return h("div", { class: "sidecar-external-problems", role: "alert" },
    h("p", { class: "sidecar-external-problems-head" },
      `The server rejected the call with ${problems.length === 1 ? "1 problem" : `${problems.length} problems`}. The agent received this as is; nothing was retried.`),
    h("ul", null, problems.map((p, i) => h("li", { key: i }, p.field ? h("code", null, p.field) : null, p.field ? " " : null, p.message))),
  );
}
