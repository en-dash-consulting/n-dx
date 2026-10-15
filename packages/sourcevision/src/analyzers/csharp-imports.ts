/**
 * C# import resolver.
 *
 * C# has no file-level imports: `using X.Y;` brings a NAMESPACE into scope,
 * and any file in the project may declare types in it. A file depends on
 * another file when it references a type that file declares, so the graph is
 * rebuilt from types:
 *
 *   1. Every file's declared types (`class`, `interface`, `struct`, `record`,
 *      `enum`, `delegate`) are indexed under their namespace-qualified name.
 *      Block-scoped and file-scoped namespaces both count; `partial` types
 *      declared across several files index to every one of them.
 *   2. Every file's `using` directives (`global using`, `using static`,
 *      `using Alias = …`) and its identifier tokens are collected.
 *   3. Each identifier — or dotted name — is resolved the way the compiler
 *      looks a type name up: the file's own namespaces and their parents
 *      first, then the namespaces it (or any `global using`) imports, then
 *      aliases. A hit yields one file → file edge per declaring file.
 *
 * ASP.NET WebForms markup (`.aspx`, `.ascx`, `.master`, `.ashx`, `.asmx`)
 * has no C# body to tokenize; its `<%@ … %>` directives name what it depends
 * on: `CodeBehind`/`CodeFile`/`Src` (the code-behind file), `Inherits`/`Class`
 * (the class behind it), `MasterPageFile` (its master page) and
 * `<%@ Register Src=… %>` (each user control it uses).
 *
 * A code-behind class belongs to its page. A Web Site project compiles each
 * page on its own, so copy-pasted pages that each declare
 * `partial class _Default` hold different classes, not parts of one: a type
 * declared in a code-behind file (`X.aspx.cs`, `X.aspx.designer.cs`, or a file
 * a markup directive binds) pairs only with the other parts of the same page,
 * and a reference from elsewhere to a page class that several pages declare
 * resolves to none of them.
 *
 * A `using` of a namespace the project does not declare is an external
 * import (`System.*` is the standard library). This is a lexer pass, not a
 * compiler: a name declared twice in visible namespaces links to both, and
 * a file with several namespaces resolves every reference against all of
 * them.
 */

import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { WEBFORMS_EXTENSIONS } from "../language/csharp.js";
import type { ImportEdge, ExternalImport } from "../schema/index.js";

export interface CSharpImportResult {
  edges: ImportEdge[];
  external: ExternalImport[];
}

// ── Lexing ───────────────────────────────────────────────────────────────────

/**
 * Blank out comments, string and char literals so identifiers inside them are
 * not read as references. Newlines are kept so line-anchored patterns
 * (`using` directives) still see line starts.
 */
export function stripCSharpCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const eol = src.indexOf("\n", i);
      i = eol === -1 ? len : eol;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? len : end + 2;
      out += newlinesIn(src, i, stop);
      i = stop;
      continue;
    }
    // String literals: optional $ / @ prefixes (in either order), then either
    // a raw string ("""…""", C# 11) or a regular one.
    let j = i;
    let verbatim = false;
    while (j < len && (src[j] === "$" || src[j] === "@") && j - i < 4) {
      if (src[j] === "@") verbatim = true;
      j++;
    }
    if (src[j] === '"' && (j > i || c === '"')) {
      // An identifier ending right before `@"` / `$"` cannot happen in valid
      // C#, so a prefix here always belongs to the literal.
      let quotes = 0;
      while (src[j + quotes] === '"') quotes++;
      if (quotes >= 3) {
        const fence = '"'.repeat(quotes);
        const end = src.indexOf(fence, j + quotes);
        const stop = end === -1 ? len : end + quotes;
        out += newlinesIn(src, i, stop);
        i = stop;
        continue;
      }
      j++;
      while (j < len) {
        const ch = src[j];
        if (verbatim) {
          if (ch === '"' && src[j + 1] === '"') { j += 2; continue; }
          if (ch === '"') { j++; break; }
        } else {
          if (ch === "\\") { j += 2; continue; }
          if (ch === '"' || ch === "\n") { j++; break; }
        }
        j++;
      }
      out += newlinesIn(src, i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      // Char literal: 'x', '\n', 'A'. Bounded so a stray quote cannot
      // swallow the rest of the file.
      const end = src.indexOf("'", i + (next === "\\" ? 3 : 2));
      if (end !== -1 && end - i <= 10) {
        i = end + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

function newlinesIn(src: string, from: number, to: number): string {
  let n = "";
  for (let k = from; k < to; k++) if (src[k] === "\n") n += "\n";
  return n;
}

// ── Per-file facts ───────────────────────────────────────────────────────────

const KEYWORDS: ReadonlySet<string> = new Set([
  "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked",
  "class", "const", "continue", "decimal", "default", "delegate", "do", "double", "else",
  "enum", "event", "explicit", "extern", "false", "finally", "fixed", "float", "for",
  "foreach", "goto", "if", "implicit", "in", "int", "interface", "internal", "is", "lock",
  "long", "namespace", "new", "null", "object", "operator", "out", "override", "params",
  "private", "protected", "public", "readonly", "ref", "return", "sbyte", "sealed", "short",
  "sizeof", "stackalloc", "static", "string", "struct", "switch", "this", "throw", "true",
  "try", "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort", "using", "virtual",
  "void", "volatile", "while", "var", "where", "record", "partial", "async", "await",
  "dynamic", "get", "set", "init", "value", "global", "nameof", "when", "with", "yield",
]);

export interface CSharpFileFacts {
  /** Namespaces declared in the file, fully qualified (nested blocks joined). */
  namespaces: string[];
  /** Declared types as fully qualified names (`App.Models.User`). */
  types: string[];
  /** `using X.Y;` namespaces local to this file. */
  usings: string[];
  /** `global using X.Y;` namespaces — visible from every file. */
  globalUsings: string[];
  /** `using static X.Y.Type;` targets. */
  staticUsings: string[];
  /** `using Alias = X.Y.Z;` — alias → target. */
  aliases: Map<string, string>;
  /** Identifier and dotted-name tokens outside directives, with counts. */
  references: Map<string, number>;
}

const NAME = "@?[A-Za-z_][A-Za-z0-9_]*";
const QUALIFIED = `${NAME}(?:\\s*\\.\\s*${NAME})*`;

const USING_RE = new RegExp(
  `^[ \\t]*(global[ \\t]+)?using[ \\t]+(static[ \\t]+)?(?:(${NAME})[ \\t]*=[ \\t]*)?(${QUALIFIED})(?:[ \\t]*<[^;\\n]*>)?[ \\t]*;`,
  "gm",
);

// Ordered scan of namespace openings, type declarations and braces, so each
// declaration is attributed to the namespace block it sits in.
const STRUCTURE_RE = new RegExp(
  [
    `\\bnamespace\\s+(${QUALIFIED})\\s*([;{])`,
    `\\b(?:class|interface|struct|enum|record(?:\\s+(?:class|struct))?)\\s+(${NAME})`,
    `\\bdelegate\\s+[A-Za-z_][A-Za-z0-9_.<>,?\\[\\]\\s]*?\\s(${NAME})\\s*[<(]`,
    `[{}]`,
  ].join("|"),
  "g",
);

const TOKEN_RE = new RegExp(QUALIFIED, "g");

const clean = (name: string) => name.replace(/\s+/g, "").replace(/@/g, "");

export function extractCSharpFacts(src: string): CSharpFileFacts {
  const code = stripCSharpCommentsAndStrings(src);

  const usings: string[] = [];
  const globalUsings: string[] = [];
  const staticUsings: string[] = [];
  const aliases = new Map<string, string>();
  for (const m of code.matchAll(USING_RE)) {
    const target = clean(m[4]);
    if (m[3]) aliases.set(clean(m[3]), target);
    else if (m[2]) staticUsings.push(target);
    else (m[1] ? globalUsings : usings).push(target);
  }
  // Directives are not references; drop them before tokenizing the body.
  const body = code.replace(USING_RE, "");

  const namespaces = new Set<string>();
  const types = new Set<string>();
  const stack: Array<{ name: string; depth: number }> = [];
  let fileScoped = "";
  let depth = 0;
  for (const m of body.matchAll(STRUCTURE_RE)) {
    const current = stack.length > 0 ? stack[stack.length - 1].name : fileScoped;
    if (m[1] !== undefined) {
      const full = current ? `${current}.${clean(m[1])}` : clean(m[1]);
      namespaces.add(full);
      if (m[2] === ";") fileScoped = full;
      else stack.push({ name: full, depth: ++depth });
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const name = clean(m[3] ?? m[4]);
      if (!KEYWORDS.has(name)) types.add(current ? `${current}.${name}` : name);
    } else if (m[0] === "{") {
      depth++;
    } else {
      if (stack.length > 0 && stack[stack.length - 1].depth === depth) stack.pop();
      depth--;
    }
  }

  const references = new Map<string, number>();
  for (const m of body.matchAll(TOKEN_RE)) {
    const token = clean(m[0]);
    if (KEYWORDS.has(token)) continue;
    references.set(token, (references.get(token) ?? 0) + 1);
  }

  return {
    namespaces: [...namespaces],
    types: [...types],
    usings,
    globalUsings,
    staticUsings,
    aliases,
    references,
  };
}

// ── WebForms markup ─────────────────────────────────────────────────────────

export interface WebFormsReferences {
  /** Paths as written: code-behind, master page, registered controls. */
  paths: string[];
  /** Fully qualified class names from `Inherits=` / `Class=`. */
  classes: string[];
}

const DIRECTIVE_RE = /<%@\s*(\w+)([\s\S]*?)%>/g;
const ATTRIBUTE_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Read the file and class references out of a markup file's directives. */
export function extractWebFormsReferences(src: string): WebFormsReferences {
  const paths: string[] = [];
  const classes: string[] = [];
  for (const d of src.matchAll(DIRECTIVE_RE)) {
    const directive = d[1].toLowerCase();
    for (const a of d[2].matchAll(ATTRIBUTE_RE)) {
      const name = a[1].toLowerCase();
      const value = (a[2] ?? a[3]).trim();
      if (!value) continue;
      if (name === "inherits" || name === "class") {
        classes.push(value.split(",")[0].trim());
      } else if (
        name === "codebehind" || name === "codefile" || name === "masterpagefile" ||
        (name === "src" && directive !== "assembly")
      ) {
        paths.push(value);
      }
    }
  }
  return { paths, classes };
}

/**
 * Resolve a markup path to an inventoried file. Relative paths are taken from
 * the markup file's directory; `~/` is the web application root, which is not
 * known here, so each ancestor of the markup file is tried, nearest first.
 */
function resolveMarkupPath(from: string, written: string, known: ReadonlySet<string>): string | undefined {
  const value = written.replace(/\\/g, "/");
  const dir = posix.dirname(from);
  if (!value.startsWith("~/")) {
    const candidate = posix.normalize(value.startsWith("/") ? value.slice(1) : posix.join(dir, value));
    return known.has(candidate) ? candidate : undefined;
  }
  const rest = value.slice(2);
  for (let base = dir; ; base = posix.dirname(base)) {
    const candidate = posix.normalize(base === "." ? rest : posix.join(base, rest));
    if (known.has(candidate)) return candidate;
    if (base === "." || base === "/" || base === "") return undefined;
  }
}

/** `Default.aspx.cs` / `Default.aspx.designer.cs` → the page `Default.aspx`. */
const CODE_BEHIND_RE = /^(.*\.(?:aspx|ascx|master|ashx|asmx))(?:\.designer)?\.cs$/i;

const isMarkup = (path: string) => {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && WEBFORMS_EXTENSIONS.has(path.slice(dot).toLowerCase());
};

// ── Resolution ───────────────────────────────────────────────────────────────

/** `A.B.C` → [`A.B.C`, `A.B`, `A`, ``]: the lookup order for enclosing namespaces. */
function namespaceChain(ns: string): string[] {
  const parts = ns.split(".");
  const out: string[] = [];
  for (let k = parts.length; k > 0; k--) out.push(parts.slice(0, k).join("."));
  out.push("");
  return out;
}

const qualify = (ns: string, name: string) => (ns ? `${ns}.${name}` : name);

function isStdlib(ns: string): boolean {
  return ns === "System" || ns.startsWith("System.");
}

/**
 * Build the C# import graph. Types are indexed across `allFiles`, so a
 * reference resolves even when its target was not re-parsed this run; edges
 * and external imports are emitted only for `emitFor` (every file when
 * omitted), which is how the incremental path re-parses changed files only.
 */
export async function buildCSharpImportGraph(
  allFiles: Array<{ path: string }>,
  targetDir: string,
  emitFor?: ReadonlySet<string>,
): Promise<CSharpImportResult> {
  const facts = new Map<string, CSharpFileFacts>();
  const markup = new Map<string, WebFormsReferences>();
  for (const f of allFiles) {
    let text: string;
    try {
      text = await readFile(join(targetDir, f.path), "utf-8");
    } catch {
      continue; // Unreadable files contribute nothing.
    }
    if (isMarkup(f.path)) markup.set(f.path, extractWebFormsReferences(text));
    else facts.set(f.path, extractCSharpFacts(text));
  }
  const known = new Set(allFiles.map((f) => f.path));

  // Page of every markup file (itself) and code-behind file (the markup that
  // binds it, else the page its name implies).
  const pageOf = new Map<string, string>();
  for (const [path, refs] of markup) {
    pageOf.set(path, path);
    for (const written of refs.paths) {
      const to = resolveMarkupPath(path, written, known);
      if (to && facts.has(to)) pageOf.set(to, path);
    }
  }
  for (const path of facts.keys()) {
    const m = pageOf.has(path) ? null : CODE_BEHIND_RE.exec(path);
    if (m) pageOf.set(path, m[1]);
  }

  // Index: fully qualified type → declaring files (page types per page);
  // every namespace the project declares (with parents); last segments, to
  // skip tokens cheaply.
  const typeIndex = new Map<string, string[]>();
  const pageTypeIndex = new Map<string, Map<string, string[]>>();
  const projectNamespaces = new Set<string>();
  const shortNames = new Set<string>();
  const globalUsings = new Set<string>();
  const addTo = (index: Map<string, string[]>, key: string, path: string) => {
    const files = index.get(key) ?? [];
    if (!files.includes(path)) files.push(path);
    index.set(key, files);
  };
  for (const [path, f] of facts) {
    const page = pageOf.get(path);
    for (const t of f.types) {
      if (page === undefined) {
        addTo(typeIndex, t, path);
      } else {
        const byPage = pageTypeIndex.get(t) ?? new Map<string, string[]>();
        addTo(byPage, page, path);
        pageTypeIndex.set(t, byPage);
      }
      shortNames.add(t.slice(t.lastIndexOf(".") + 1));
    }
    for (const ns of f.namespaces) {
      for (const n of namespaceChain(ns)) if (n) projectNamespaces.add(n);
    }
    for (const u of f.globalUsings) globalUsings.add(u);
  }

  const edgeMap = new Map<string, ImportEdge>();
  const externalMap = new Map<string, ExternalImport>();

  const link = (from: string, to: string, symbol: string, count: number) => {
    if (to === from) return;
    const key = `${from}\0${to}\0static`;
    const existing = edgeMap.get(key);
    if (existing) {
      if (!existing.symbols.includes(symbol)) existing.symbols.push(symbol);
      existing.weight = (existing.weight ?? 0) + count;
    } else {
      edgeMap.set(key, { from, to, type: "static", symbols: [symbol], weight: count });
    }
  };
  /**
   * Files declaring `typeName` as seen from `page` (undefined outside any
   * page): the page's own parts first, then a shared type, then a page type
   * only one page declares. A page type several pages declare is ambiguous.
   */
  const declaringFiles = (typeName: string, page: string | undefined): string[] | undefined => {
    const byPage = pageTypeIndex.get(typeName);
    if (page !== undefined && byPage?.has(page)) return byPage.get(page);
    const shared = typeIndex.get(typeName);
    if (shared) return shared;
    if (byPage?.size === 1) return byPage.values().next().value;
    return undefined;
  };
  const isProjectType = (typeName: string) => typeIndex.has(typeName) || pageTypeIndex.has(typeName);
  const addEdge = (from: string, typeName: string, count: number) => {
    const short = typeName.slice(typeName.lastIndexOf(".") + 1);
    for (const to of declaringFiles(typeName, pageOf.get(from)) ?? []) link(from, to, short, count);
  };

  for (const [path, refs] of markup) {
    if (emitFor && !emitFor.has(path)) continue;
    for (const written of refs.paths) {
      const to = resolveMarkupPath(path, written, known);
      if (to) link(path, to, posix.basename(to), 1);
    }
    for (const cls of refs.classes) addEdge(path, cls, 1);
  }

  for (const [path, f] of facts) {
    if (emitFor && !emitFor.has(path)) continue;

    const scopes = new Set<string>();
    for (const ns of f.namespaces.length > 0 ? f.namespaces : [""]) {
      for (const n of namespaceChain(ns)) scopes.add(n);
    }
    const imported = [...new Set([...f.usings, ...globalUsings])];
    const page = pageOf.get(path);
    const resolves = (full: string) => declaringFiles(full, page) !== undefined;

    const lookup = (name: string): string | undefined => {
      for (const s of scopes) {
        const full = qualify(s, name);
        if (resolves(full)) return full;
      }
      for (const u of imported) {
        const full = qualify(u, name);
        if (resolves(full)) return full;
      }
      const dot = name.indexOf(".");
      const head = dot === -1 ? name : name.slice(0, dot);
      const alias = f.aliases.get(head);
      if (alias !== undefined) {
        const full = dot === -1 ? alias : alias + name.slice(dot);
        if (resolves(full)) return full;
      }
      return undefined;
    };

    // A dotted token is `Namespace.Type`, `Type.Member`, `Alias.Type` or
    // `variable.Member`: the longest prefix that names a type wins. Attribute
    // usages drop their `Attribute` suffix (`[Audited]` → AuditedAttribute).
    for (const [token, count] of f.references) {
      const parts = token.split(".");
      if (!parts.some((p) => shortNames.has(p) || shortNames.has(`${p}Attribute`) || f.aliases.has(p))) continue;
      for (let k = parts.length; k > 0; k--) {
        const prefix = parts.slice(0, k).join(".");
        const hit = lookup(prefix) ?? lookup(`${prefix}Attribute`);
        if (hit) {
          addEdge(path, hit, count);
          break;
        }
      }
    }

    for (const target of [...f.staticUsings, ...f.aliases.values()]) {
      if (resolves(target)) addEdge(path, target, 1);
    }

    const externalNamespaces = [...f.usings, ...f.globalUsings, ...f.staticUsings, ...f.aliases.values()]
      .filter((ns) => !projectNamespaces.has(ns) && !isProjectType(ns));
    for (const ns of externalNamespaces) {
      // `using static`/alias targets name a type; the package is its namespace.
      const pkgNs = f.staticUsings.includes(ns) || [...f.aliases.values()].includes(ns)
        ? ns.slice(0, Math.max(ns.lastIndexOf("."), 0)) || ns
        : ns;
      if (projectNamespaces.has(pkgNs)) continue;
      const pkg = isStdlib(pkgNs) ? `stdlib:${pkgNs}` : pkgNs;
      const existing = externalMap.get(pkg);
      if (existing) {
        if (!existing.importedBy.includes(path)) existing.importedBy.push(path);
      } else {
        externalMap.set(pkg, { package: pkg, importedBy: [path], symbols: ["*"] });
      }
    }
  }

  // Same cap as the Swift resolver: a composition root referenced fifty times
  // should outweigh a single mention, not dominate Louvain by 50×.
  const EDGE_WEIGHT_CAP = 10;
  for (const edge of edgeMap.values()) {
    if (edge.weight !== undefined && edge.weight > EDGE_WEIGHT_CAP) edge.weight = EDGE_WEIGHT_CAP;
  }

  return { edges: [...edgeMap.values()], external: [...externalMap.values()] };
}
