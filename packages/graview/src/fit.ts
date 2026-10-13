/**
 * Whether the snapshot fits the declaration. `graview check` judges the
 * declaration alone, so a record with an enum value the declaration does not
 * offer, or an edge whose far end is a kind the relation does not reach,
 * passes it and fails later, at `serve`, in front of whoever opened the face.
 * This reads the pair the way Graview will: every record's kind and fields
 * against its kind's declaration, every edge against the relation declared on
 * the kind it leaves. Plain data over the checked-in JSON, so the adapter
 * still imports nothing from Graview.
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
}

interface EdgeSpec {
  to: readonly string[] | "*";
  cardinality?: "one" | "many";
}

interface KindSpec {
  fields: Record<string, FieldSpec>;
  edges?: Record<string, EdgeSpec>;
}

const show = (value: unknown): string => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

/** Why a value is not of the declared type, or undefined when it is. */
function wrongType(spec: FieldSpec, value: unknown): string | undefined {
  switch (spec.type) {
    case "string":
    case "text":
      return typeof value === "string" ? undefined : `is ${show(value)}, not a string`;
    case "datetime":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? undefined : `is ${show(value)}, not a date and time`;
    case "boolean":
      return typeof value === "boolean" ? undefined : `is ${show(value)}, not true or false`;
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `is ${show(value)}, not a number`;
      if (spec.type === "integer" && !Number.isInteger(value)) return `is ${value}, not a whole number`;
      if (spec.min !== undefined && value < spec.min) return `is ${value}, below the declared minimum ${spec.min}`;
      if (spec.max !== undefined && value > spec.max) return `is ${value}, above the declared maximum ${spec.max}`;
      return undefined;
    }
    case "enum":
      return typeof value === "string" && (spec.options ?? []).includes(value) ? undefined : `is ${show(value)}, which is not one of ${(spec.options ?? []).join(", ")}`;
    case "list": {
      if (!Array.isArray(value)) return `is ${show(value)}, not a list`;
      if (!spec.of) return undefined;
      const bad = value.find((item) => wrongType({ type: spec.of! }, item) !== undefined);
      return bad === undefined ? undefined : `holds ${show(bad)}, not a ${spec.of}`;
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
    const spec = kinds[node.kind];
    if (!spec) {
      misfits.push({ record: node.id, kind: node.kind, at: "kind", message: `kind "${node.kind}" is not declared` });
      continue;
    }
    for (const [field, value] of Object.entries(node)) {
      if (field === "id" || field === "kind" || value === undefined || value === null) continue;
      const fieldSpec = spec.fields[field];
      if (!fieldSpec) {
        misfits.push({ record: node.id, kind: node.kind, at: field, message: `${node.kind}.${field} is not declared` });
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

/** The misfits as lines a person reads, the first `limit` of them and a count of the rest. */
export function describeMisfits(misfits: readonly Misfit[], limit = 20): string {
  const lines = misfits.slice(0, limit).map((m) => `  ${m.record}: ${m.message}`);
  if (misfits.length > limit) lines.push(`  and ${misfits.length - limit} more`);
  return `${misfits.length} ${misfits.length === 1 ? "record does" : "records do"} not fit the declaration:\n${lines.join("\n")}`;
}
