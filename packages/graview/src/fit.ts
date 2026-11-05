/**
 * Whether the snapshot fits the declaration. `graview check` judges the
 * declaration alone, so a record with an enum value the declaration does not
 * offer, or an edge whose far end is a kind the relation does not reach,
 * passes it, and Graview's `validateGraph` reports the record when a face
 * loads the pair. This holds the pair to at least what Graview holds it to:
 * every record's kind and fields against its kind's declaration (types, enum
 * options, ranges and steps, Graview's length caps on strings, texts and
 * lists, and no `null` where Graview takes only an absent field), every edge
 * against the relation declared on the kind it leaves. It is stricter in two
 * places Graview lets through: an undeclared field (Graview strips it) and a
 * relation declared to reach one record that reaches more (Graview holds that
 * only in acts). A type it does not know is Graview's to judge. Plain data
 * over the checked-in JSON, so the adapter still imports nothing from
 * Graview; `tests/unit/fit.test.ts` holds it to `validateGraph`.
 */
import type { GraviewDocumentData } from "./document.js";
import type { GraphSnapshot } from "./types.js";

/** One way a record or an edge does not fit; `record` is the node id, or the edge's `from`. */
export interface Misfit {
  record: string;
  kind: string;
  /** The field or the relation at fault. */
  at: string;
  message: string;
}

interface FieldSpec {
  type: string;
  required?: boolean;
  options?: readonly string[];
  of?: string;
  min?: number;
  max?: number;
  step?: number;
}

interface EdgeSpec {
  to: readonly string[] | "*";
  cardinality?: "one" | "many";
}

interface KindSpec {
  fields: Record<string, FieldSpec>;
  edges?: Record<string, EdgeSpec>;
}

/** Graview's caps (`@graview/core` `fieldSchema`): a string, a text, a list, and each string in a list. */
export const STRING_MAX = 500;
export const TEXT_MAX = 20_000;
export const LIST_MAX = 200;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const show = (value: unknown): string => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

/** Why a value is not of the declared type, or undefined when it is. */
function wrongType(spec: FieldSpec, value: unknown): string | undefined {
  switch (spec.type) {
    case "string":
    case "text": {
      if (typeof value !== "string") return `is ${show(value)}, not a string`;
      const max = spec.type === "string" ? STRING_MAX : TEXT_MAX;
      return value.length > max ? `is ${value.length} characters, over Graview's ${max}` : undefined;
    }
    case "date":
      return typeof value === "string" && ISO_DAY.test(value) ? undefined : `is ${show(value)}, not a date like 2026-10-02`;
    case "datetime":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? undefined : `is ${show(value)}, not a date and time`;
    case "boolean":
      return typeof value === "boolean" ? undefined : `is ${show(value)}, not true or false`;
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `is ${show(value)}, not a number`;
      // Graview's z.int() is a safe integer: a whole number past 2^53 is refused too.
      if (spec.type === "integer" && !Number.isSafeInteger(value)) return `is ${value}, not a whole number Graview can hold`;
      if (spec.min !== undefined && value < spec.min) return `is ${value}, below the declared minimum ${spec.min}`;
      if (spec.max !== undefined && value > spec.max) return `is ${value}, above the declared maximum ${spec.max}`;
      if (spec.step !== undefined && spec.step > 0 && Math.abs(value / spec.step - Math.round(value / spec.step)) > 1e-9) {
        return `is ${value}, not a multiple of the declared step ${spec.step}`;
      }
      return undefined;
    }
    case "enum":
      return typeof value === "string" && (spec.options ?? []).includes(value) ? undefined : `is ${show(value)}, which is not one of ${(spec.options ?? []).join(", ")}`;
    case "list": {
      if (!Array.isArray(value)) return `is ${show(value)}, not a list`;
      if (value.length > LIST_MAX) return `holds ${value.length} items, over Graview's ${LIST_MAX}`;
      // Graview reads a list's items as strings of at most 500 characters unless `of` names numbers, days or files.
      if (spec.of === "image" || spec.of === "file") return undefined;
      const of = spec.of === "number" || spec.of === "date" ? spec.of : "string";
      const bad = value.find((item) => wrongType({ type: of }, item) !== undefined);
      if (bad === undefined) return undefined;
      return `holds ${show(bad)}, which is not ${of === "string" ? `a string of at most ${STRING_MAX} characters` : `a ${of}`}`;
    }
    default:
      // A type this check does not know yet is Graview's to judge, not a misfit.
      return undefined;
  }
}

export function fitSnapshot(doc: GraviewDocumentData, snapshot: GraphSnapshot): Misfit[] {
  const kinds = doc.kinds as unknown as Record<string, KindSpec>;
  const misfits: Misfit[] = [];
  const kindOf = new Map<string, string>();

  for (const node of snapshot.nodes) {
    kindOf.set(node.id, node.kind);
    if (typeof node.id !== "string" || node.id.length === 0) {
      misfits.push({ record: String(node.id), kind: node.kind, at: "id", message: `a ${node.kind} record has no id` });
    }
    const spec = kinds[node.kind];
    if (!spec) {
      misfits.push({ record: node.id, kind: node.kind, at: "kind", message: `kind "${node.kind}" is not declared` });
      continue;
    }
    for (const [field, value] of Object.entries(node)) {
      if (field === "id" || field === "kind" || value === undefined) continue;
      const fieldSpec = spec.fields[field];
      if (!fieldSpec) {
        misfits.push({ record: node.id, kind: node.kind, at: field, message: `${node.kind}.${field} is not declared` });
        continue;
      }
      if (value === null) {
        // Graview takes an absent field, never a null one; a required one is reported as missing below.
        if (!fieldSpec.required) misfits.push({ record: node.id, kind: node.kind, at: field, message: `${node.kind}.${field} is null; leave it out instead` });
        continue;
      }
      const why = wrongType(fieldSpec, value);
      if (why) misfits.push({ record: node.id, kind: node.kind, at: field, message: `${node.kind}.${field} ${why}` });
    }
    for (const [field, fieldSpec] of Object.entries(spec.fields)) {
      if (fieldSpec.required && (node[field] === undefined || node[field] === null)) {
        misfits.push({ record: node.id, kind: node.kind, at: field, message: `${node.kind}.${field} is required and missing` });
      }
    }
  }

  const ones = new Map<string, number>();
  for (const edge of snapshot.edges) {
    const fromKind = kindOf.get(edge.from);
    const toKind = kindOf.get(edge.to);
    if (fromKind === undefined || toKind === undefined) {
      misfits.push({ record: edge.from, kind: fromKind ?? "?", at: edge.kind, message: `${edge.kind} reaches ${fromKind === undefined ? edge.from : edge.to}, which is not in the snapshot` });
      continue;
    }
    const spec = kinds[fromKind]?.edges?.[edge.kind];
    if (!spec) {
      misfits.push({ record: edge.from, kind: fromKind, at: edge.kind, message: `${fromKind} declares no relation "${edge.kind}"` });
      continue;
    }
    if (spec.to !== "*" && !spec.to.includes(toKind)) {
      misfits.push({ record: edge.from, kind: fromKind, at: edge.kind, message: `${fromKind}.${edge.kind} reaches a ${toKind} (${edge.to}); it is declared to reach ${spec.to.join(" or ")}` });
    }
    if (spec.cardinality === "one") {
      const key = `${edge.from}\u0000${edge.kind}`;
      const n = (ones.get(key) ?? 0) + 1;
      ones.set(key, n);
      if (n === 2) misfits.push({ record: edge.from, kind: fromKind, at: edge.kind, message: `${fromKind}.${edge.kind} is declared to reach one record and reaches more` });
    }
  }
  return misfits;
}

/**
 * Cut what rex, git or sourcevision wrote to Graview's caps, so a valid PRD
 * never fails `check` for its length: a string to 500 characters, a text to
 * 20,000, a list to 200 items of at most 500 characters each. A cut string
 * ends in an ellipsis. Returns how many fields were cut, by kind and field,
 * for one warning; the nodes are changed in place.
 */
export function clampToCaps(doc: GraviewDocumentData, nodes: Iterable<Record<string, unknown> & { kind: string }>): Map<string, number> {
  const kinds = doc.kinds as unknown as Record<string, KindSpec>;
  const cut = new Map<string, number>();
  const count = (kind: string, field: string) => cut.set(`${kind}.${field}`, (cut.get(`${kind}.${field}`) ?? 0) + 1);
  const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  for (const node of nodes) {
    const fields = kinds[node.kind]?.fields;
    if (!fields) continue;
    for (const [field, spec] of Object.entries(fields)) {
      const value = node[field];
      if ((spec.type === "string" || spec.type === "text") && typeof value === "string") {
        const max = spec.type === "string" ? STRING_MAX : TEXT_MAX;
        if (value.length > max) {
          node[field] = shorten(value, max);
          count(node.kind, field);
        }
      } else if (spec.type === "list" && Array.isArray(value)) {
        const strings = spec.of !== "number" && spec.of !== "date" && spec.of !== "image" && spec.of !== "file";
        const items = value.slice(0, LIST_MAX).map((item) => (strings && typeof item === "string" ? shorten(item, STRING_MAX) : item));
        if (items.length < value.length || items.some((item, i) => item !== value[i])) {
          node[field] = items;
          count(node.kind, field);
        }
      }
    }
  }
  return cut;
}

/** The misfits as lines a person reads, the first `limit` of them and a count of the rest. */
export function describeMisfits(misfits: readonly Misfit[], limit = 20): string {
  const lines = misfits.slice(0, limit).map((m) => `  ${m.record}: ${m.message}`);
  if (misfits.length > limit) lines.push(`  and ${misfits.length - limit} more`);
  const records = new Set(misfits.map((m) => m.record)).size;
  const count = `${misfits.length} ${misfits.length === 1 ? "misfit" : "misfits"} in ${records} ${records === 1 ? "record" : "records"}`;
  return `${count} against the declaration:\n${lines.join("\n")}`;
}
