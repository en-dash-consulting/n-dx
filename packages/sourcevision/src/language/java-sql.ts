/**
 * Table names from SQL embedded in Java: Spring Data `@Query` (native and
 * JPQL), JPA `@Table`, and JdbcTemplate calls. Results stay in memory:
 * nothing here is written to an analysis artifact.
 *
 * Works on the captures of the Java pack's `calls`, `declarations` and
 * `annotations` queries. Only string literals written in place are read; a
 * statement built by concatenation or held in a constant is not seen.
 *
 * JPQL names entities, not tables. An entity maps to its `@Table(name)`; an
 * `@Entity` without one maps to its own name, which is the JPA default before
 * a naming strategy (Spring Boot's snake-cases it) is applied. A JPQL name
 * that no scanned `@Entity` explains is returned in `unresolved` rather than
 * guessed.
 *
 * @module sourcevision/language/java-sql
 */

import type { CallFact } from "@n-dx/lang-kit";
import { contains, groupCalls, innermost, type Capture, type ParsedFile } from "@n-dx/lang-runtime";
import {
  extractSqlTableReferences,
  looksLikeSql,
  type EmbeddedSqlTable,
} from "./sql-references.js";

export interface UnresolvedEntity {
  readonly name: string;
  readonly path: string;
  readonly line: number;
}

export interface JavaEmbeddedSql {
  readonly tables: readonly EmbeddedSqlTable[];
  /** JPQL entity names with no `@Entity` among the scanned files. */
  readonly unresolved: readonly UnresolvedEntity[];
}

/** JdbcTemplate (and NamedParameterJdbcTemplate) methods whose string argument is SQL. */
const JDBC_METHODS = new Set([
  "query", "queryForObject", "queryForList", "queryForMap", "queryForRowSet", "queryForStream",
  "update", "batchUpdate", "execute",
]);

/** A receiver counts as a JDBC template when its name says so; no types are resolved. */
const JDBC_RECEIVER = /jdbc/i;

/** The text of a Java string literal or text block, and whether it was a text block. */
export function javaStringValue(literal: string): { text: string; textBlock: boolean } {
  if (literal.startsWith('"""')) {
    const body = literal.slice(3, -3);
    const afterOpening = body.replace(/^[ \t]*\r?\n/, "");
    return { text: afterOpening, textBlock: true };
  }
  const body = literal.slice(1, -1);
  const text = body.replace(/\\(.)/gs, (_match, ch: string) => (ch === "n" || ch === "t" || ch === "r" ? " " : ch));
  return { text, textBlock: false };
}

/** Last segment of a possibly qualified annotation name. */
const simpleName = (name: string): string => name.slice(name.lastIndexOf(".") + 1);

interface Annotation {
  readonly name: string;
  readonly use: Capture;
  /** Named string values, by key. */
  readonly strings: ReadonlyMap<string, Capture>;
  readonly trueKeys: ReadonlySet<string>;
  /** The unnamed single value. */
  readonly value?: Capture;
}

function readAnnotations(captures: readonly Capture[]): Annotation[] {
  const named = (name: string): Capture[] => captures.filter((c) => c.name === name);
  const uses = named("annotation.use");
  const pairs = named("annotation.pair");
  const keys = named("annotation.key");
  const stringValues = named("annotation.string_value");
  const trueValues = named("annotation.true_value");
  const names = named("annotation.name");
  const unnamed = named("annotation.string_argument");

  // Each capture's owning annotation once, so cost stays linear in captures × uses.
  const byUse = (captured: readonly Capture[]): Map<Capture, Capture[]> => {
    const owned = new Map<Capture, Capture[]>();
    for (const c of captured) {
      const owner = innermost(uses, c);
      if (owner) owned.set(owner, [...(owned.get(owner) ?? []), c]);
    }
    return owned;
  };
  const pairsByUse = byUse(pairs);
  const unnamedByUse = byUse(unnamed);

  return uses.map((use) => {
    const nameCapture = names.find((n) => contains(use, n));
    const strings = new Map<string, Capture>();
    const trueKeys = new Set<string>();
    for (const pair of pairsByUse.get(use) ?? []) {
      const key = keys.find((k) => contains(pair, k));
      if (!key) continue;
      const value = stringValues.find((v) => contains(pair, v));
      if (value) strings.set(key.text, value);
      else if (trueValues.some((v) => contains(pair, v))) trueKeys.add(key.text);
    }
    // `@Query("...")`: a string that is not a pair's value is the unnamed one.
    const value = (unnamedByUse.get(use) ?? []).find((s) => !stringValues.some((v) => contains(v, s)));
    return {
      name: simpleName(nameCapture?.text ?? ""),
      use,
      strings,
      trueKeys,
      ...(value ? { value } : {}),
    };
  });
}

interface Entity {
  readonly name: string;
  /** `@Table(name)`, when present. */
  readonly table?: { name: string; schema?: string };
}

/**
 * Spring Data JDBC and R2DBC `@Query` is always native SQL, and their `@Table`
 * (Spring Data relational) takes the table name as its value. Only an explicit
 * single-type import proves which annotation a simple name means; a wildcard
 * import leaves it ambiguous and the JPA reading stands.
 */
const NATIVE_QUERY_IMPORTS: readonly string[] = [
  "org.springframework.data.jdbc.repository.query.Query",
  "org.springframework.data.r2dbc.repository.Query",
];
const RELATIONAL_TABLE_IMPORT = "org.springframework.data.relational.core.mapping.Table";

/** Fully qualified names of the file's single-type, non-static imports. */
function readImports(captures: readonly Capture[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const decl of captures.filter((c) => c.name === "import.declaration")) {
    const inside = captures.filter((c) => c !== decl && contains(decl, c));
    const name = inside.find((c) => c.name === "import.name");
    if (!name || inside.some((c) => c.name === "import.static" || c.name === "import.wildcard")) continue;
    names.add(name.text.replace(/\s+/g, ""));
  }
  return names;
}

interface FileFacts {
  readonly path: string;
  readonly imports: ReadonlySet<string>;
  readonly annotations: readonly Annotation[];
  readonly entities: readonly Entity[];
  readonly calls: readonly CallFact[];
}

function readFile(file: ParsedFile): FileFacts {
  const annotations = readAnnotations(file.captures.annotations ?? []);
  const declarations = file.captures.declarations ?? [];
  const typeNodes = declarations.filter((c) => c.name.startsWith("type.") && c.name !== "type.name");
  const typeNames = declarations.filter((c) => c.name === "type.name");

  const entities: Entity[] = [];
  for (const type of typeNodes) {
    const onType = annotations.filter((a) => innermost(typeNodes, a.use) === type);
    const entity = onType.find((a) => a.name === "Entity");
    if (!entity) continue;
    const declared = typeNames.find((n) => contains(type, n))?.text;
    const renamed = entity.strings.get("name");
    const name = renamed ? javaStringValue(renamed.text).text : declared;
    if (name === undefined) continue;
    const table = onType.find((a) => a.name === "Table");
    const tableName = table?.strings.get("name");
    const tableSchema = table?.strings.get("schema");
    entities.push({
      name,
      ...(tableName
        ? {
            table: {
              name: javaStringValue(tableName.text).text,
              ...(tableSchema ? { schema: javaStringValue(tableSchema.text).text } : {}),
            },
          }
        : {}),
    });
  }
  return { path: file.path, imports: readImports(file.captures.imports ?? []), annotations, entities, calls: groupCalls(file.captures.calls ?? []) };
}

/**
 * Find the tables named by embedded SQL in parsed Java files.
 *
 * @param files Results of running the Java pack's runner; entities are
 *   collected across all of them before any JPQL is mapped.
 */
export function extractJavaEmbeddedSql(files: readonly ParsedFile[]): JavaEmbeddedSql {
  const facts = files.map(readFile);
  const entities = new Map<string, Entity>();
  for (const file of facts) for (const entity of file.entities) entities.set(entity.name, entity);

  const tables: EmbeddedSqlTable[] = [];
  const unresolved: UnresolvedEntity[] = [];

  for (const file of facts) {
    for (const annotation of file.annotations) {
      if (annotation.name === "Table") {
        const relational = file.imports.has(RELATIONAL_TABLE_IMPORT);
        const name =
          annotation.strings.get("name") ??
          (relational ? (annotation.strings.get("value") ?? annotation.value) : undefined);
        const schema = annotation.strings.get("schema");
        if (!name) continue;
        tables.push({
          name: javaStringValue(name.text).text,
          ...(schema ? { schema: javaStringValue(schema.text).text } : {}),
          path: file.path,
          line: name.start.line,
          origin: "annotation",
          via: "@Table",
        });
      } else if (annotation.name === "Query") {
        const literal = annotation.strings.get("value") ?? annotation.value;
        if (!literal) continue;
        const { text, textBlock } = javaStringValue(literal.text);
        const references = extractSqlTableReferences(text, literal.start.line + (textBlock ? 1 : 0));
        const native =
          annotation.trueKeys.has("nativeQuery") || NATIVE_QUERY_IMPORTS.some((i) => file.imports.has(i));
        if (native) {
          for (const ref of references) {
            tables.push({
              name: ref.name,
              ...(ref.schema === undefined ? {} : { schema: ref.schema }),
              path: file.path,
              line: ref.line,
              origin: "annotation",
              via: "@Query (native)",
            });
          }
          continue;
        }
        for (const ref of references) {
          const entity = entities.get(ref.name);
          if (!entity) {
            unresolved.push({ name: ref.name, path: file.path, line: ref.line });
            continue;
          }
          tables.push({
            name: entity.table?.name ?? entity.name,
            ...(entity.table?.schema === undefined ? {} : { schema: entity.table.schema }),
            path: file.path,
            line: ref.line,
            origin: "annotation",
            via: "@Query (JPQL)",
            entity: entity.name,
          });
        }
      }
    }

    for (const call of file.calls) {
      if (call.callee === undefined || !JDBC_METHODS.has(call.callee)) continue;
      if (call.receiver === undefined || !JDBC_RECEIVER.test(call.receiver)) continue;
      for (const literal of call.strings) {
        const { text, textBlock } = javaStringValue(literal.text);
        if (!looksLikeSql(text)) continue;
        for (const ref of extractSqlTableReferences(text, literal.start.line + (textBlock ? 1 : 0))) {
          tables.push({
            name: ref.name,
            ...(ref.schema === undefined ? {} : { schema: ref.schema }),
            path: file.path,
            line: ref.line,
            origin: "call",
            via: `JdbcTemplate.${call.callee}`,
          });
        }
      }
    }
  }
  return { tables, unresolved };
}
