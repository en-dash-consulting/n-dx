/**
 * The declaration is held to rex: every v2 node type has a kind, every
 * derived product edge is read from a declared relation, and the document is
 * well-formed by the rules `graview check` would apply to its names.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDocument, documentFor, declaredEdges, NODE_KINDS, PRODUCT_EDGE_SOURCES, DOCUMENT_PATH } from "../../src/document.js";
import { NODE_TYPES } from "../../src/rex-gateway.js";

const KIND_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FIELD_NAME = /^[a-z][A-Za-z0-9]*$/;
const EDGE_NAME = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|[a-z][A-Za-z0-9]*)$/;
const REQUIRED_LENSES = ["columns", "timeline", "coverage", "calendar", "blocks"];

describe("n-dx.graview.json", () => {
  const doc = loadDocument();

  it("is a graview-document v1 within the format's limits", () => {
    expect(doc.format).toBe("graview-document");
    expect(doc.formatVersion).toBe(1);
    expect(Object.keys(doc.kinds).length).toBeGreaterThan(0);
    expect(Object.keys(doc.kinds).length).toBeLessThanOrEqual(40);
    expect(readFileSync(DOCUMENT_PATH).byteLength).toBeLessThan(256 * 1024);
  });

  it("declares a kind for every rex v2 node type", () => {
    for (const type of NODE_TYPES) {
      const kind = NODE_KINDS[type];
      expect(kind, `NODE_KINDS has no kind for rex type "${type}"`).toBeDefined();
      expect(doc.kinds[kind], `document declares no kind "${kind}" for rex type "${type}"`).toBeDefined();
    }
  });

  it("declares an edge for every rex derived product edge", () => {
    const edges = declaredEdges(doc);
    for (const [derived, sources] of Object.entries(PRODUCT_EDGE_SOURCES)) {
      expect(sources.length, `${derived} is read from no declared edge`).toBeGreaterThan(0);
      for (const edge of sources) expect(edges.has(edge), `${derived} reads "${edge}", which no kind declares`).toBe(true);
    }
  });

  it("declares the edges the snapshot builder emits", () => {
    const edges = declaredEdges(doc);
    for (const edge of [
      "under", "dependsOn", "appliesTo", "amends", "touches", "blockedBy", "discoveredFrom",
      "plannedFor", "shippedWith", "realizedIn", "realizes", "inZone", "crosses", "ranFor", "produced",
    ]) {
      expect(edges.has(edge), `edge "${edge}" is emitted but not declared`).toBe(true);
    }
  });

  it("names kinds, fields and edges the way the format requires, and every edge target is a kind", () => {
    for (const [kind, spec] of Object.entries(doc.kinds)) {
      expect(kind).toMatch(KIND_NAME);
      expect(Object.keys(spec.fields).length).toBeGreaterThan(0);
      for (const field of Object.keys(spec.fields)) {
        expect(field, `${kind}.${field}`).toMatch(FIELD_NAME);
        expect(["id", "kind"]).not.toContain(field);
      }
      for (const [edge, edgeSpec] of Object.entries(spec.edges ?? {})) {
        expect(edge, `${kind}.${edge}`).toMatch(EDGE_NAME);
        if (edgeSpec.to !== "*") for (const target of edgeSpec.to) expect(doc.kinds[target], `${kind}.${edge} → ${target}`).toBeDefined();
      }
      for (const field of spec.glance ?? []) expect(spec.fields[field], `${kind} glances at undeclared field ${field}`).toBeDefined();
      if (spec.lifecycle) expect(spec.fields[spec.lifecycle.field], `${kind} lifecycle names undeclared field`).toBeDefined();
      for (const [field, fieldSpec] of Object.entries(spec.fields)) {
        if (fieldSpec.type === "enum") expect(fieldSpec.options?.length, `${kind}.${field} enum has no options`).toBeGreaterThan(0);
        else expect(fieldSpec.options, `${kind}.${field} has options but is not an enum`).toBeUndefined();
      }
    }
  });

  it("opens with the titled lenses the projection promises, over declared kinds and fields", () => {
    const names = new Set((doc.lenses ?? []).map((l) => l.name));
    for (const lens of REQUIRED_LENSES) expect(names.has(lens), `lens "${lens}" missing`).toBe(true);
    for (const lens of doc.lenses ?? []) {
      expect(lens.title, `lens ${lens.name} has no title, so it is not a place`).toBeTruthy();
      if (lens.on) expect(doc.kinds[lens.on]).toBeDefined();
      if (lens.name === "columns" || lens.name === "timeline" || lens.name === "calendar") {
        for (const [kind, roles] of Object.entries(lens.bindings ?? {})) {
          expect(doc.kinds[kind]).toBeDefined();
          for (const field of Object.values(roles as Record<string, string>)) expect(doc.kinds[kind]!.fields[field], `${lens.name} binds ${kind}.${field}`).toBeDefined();
        }
      }
      if (lens.name === "coverage") {
        const b = lens.bindings as { rows: { kind: string }; columns: { kind: string }; link: { edge: string } };
        expect(doc.kinds[b.rows.kind]!.edges?.[b.link.edge]?.to).toContain(b.columns.kind);
      }
    }
  });

  it("has rules over declared kinds, each with the fields it reads", () => {
    const rules = doc.rules ?? {};
    expect(Object.keys(rules).length).toBeGreaterThanOrEqual(2);
    for (const [name, rule] of Object.entries(rules)) {
      expect(name).toMatch(KIND_NAME);
      expect(rule.over === "graph" || doc.kinds[rule.over] !== undefined, `${name} is over unknown kind ${rule.over}`).toBe(true);
      expect(rule.require.length).toBeGreaterThan(0);
    }
  });

  it("documentFor sets the name without touching the checked-in file", () => {
    const named = documentFor("  my-project  ");
    expect(named.name).toBe("my-project");
    expect(loadDocument().name).toBe("n-dx");
    expect(documentFor("   ").name).toBe("n-dx");
    expect(documentFor("x".repeat(100)).name).toHaveLength(80);
  });

  it("the pages arrangement names only declared kinds", () => {
    for (const kind of [...(doc.pages?.order ?? []), ...(doc.pages?.hide ?? [])]) expect(doc.kinds[kind], `pages names ${kind}`).toBeDefined();
    const accents = (doc.brand?.accents ?? {}) as Record<string, number>;
    for (const kind of Object.keys(accents)) expect(doc.kinds[kind], `brand.accents names ${kind}`).toBeDefined();
  });

  it("ships with the package", () => {
    const manifest = JSON.parse(readFileSync(join(DOCUMENT_PATH, "..", "package.json"), "utf-8")) as { files: string[] };
    expect(manifest.files).toContain("n-dx.graview.json");
  });
});
