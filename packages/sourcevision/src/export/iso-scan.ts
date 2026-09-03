/**
 * Standalone project scanner for the isometric map.
 *
 * Produces the same shape the map builder consumes from `.sourcevision/`, but
 * derived in a single pass over the file tree. This is what makes the map work
 * on a repository that has never been analyzed — the zones come from directory
 * structure rather than community detection, and the imports come from regexes
 * rather than a resolver, but the output is honest about that (see
 * `describeGaps` in `iso-model.ts`).
 *
 * Deliberately free of any dependency beyond `node:` builtins so this module
 * can be bundled into the standalone skill script.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, extname, basename, resolve, sep } from "node:path";

// ── Language and directory knowledge ────────────────────────────────────────

export const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".go": "Go", ".rb": "Ruby", ".java": "Java", ".kt": "Kotlin",
  ".rs": "Rust", ".php": "PHP", ".cs": "C#", ".swift": "Swift", ".scala": "Scala",
  ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".hpp": "C++", ".m": "Objective-C",
  ".vue": "Vue", ".svelte": "Svelte", ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang",
};

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
  "coverage", "vendor", "third_party", ".next", ".nuxt", ".svelte-kit",
  "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache", ".pytest_cache",
  ".turbo", ".cache", ".parcel-cache", "bower_components", "Pods", ".gradle",
  ".idea", ".vscode", ".terraform", "tmp", "temp", "site-packages",
]);

/** Directories that contain workspaces rather than being one themselves. */
const WORKSPACE_CONTAINERS = new Set([
  "packages", "apps", "services", "libs", "modules", "projects", "crates",
]);

/** Directories that hold source but are not meaningful zone names alone. */
const SOURCE_ROOTS = new Set([
  "src", "lib", "app", "source", "internal", "pkg", "cmd",
]);

/**
 * Standard-library modules. They are imports, but "everything depends on fs" is
 * not an architectural insight, so they stay out of the dependency column.
 */
const STDLIB = new Set([
  "fs", "path", "os", "url", "util", "events", "stream", "crypto", "http", "https",
  "net", "zlib", "buffer", "child_process", "worker_threads", "readline", "assert",
  "tty", "timers", "process", "querystring", "string_decoder", "perf_hooks", "vm",
  "dns", "cluster", "console", "module", "v8", "async_hooks", "diagnostics_channel",
  "sys", "json", "re", "typing", "dataclasses", "collections", "itertools", "functools",
  "logging", "datetime", "abc", "enum", "math", "random", "subprocess", "shutil",
  "tempfile", "unittest", "argparse", "io", "time", "copy", "hashlib", "base64",
  "context", "errors", "strings", "strconv", "sync", "testing", "sort", "bytes",
  "fmt", "encoding", "log", "regexp", "bufio", "flag", "reflect", "runtime",
  "unicode", "text", "html", "database", "container", "compress", "archive",
  "hash", "image", "mime", "syscall", "unsafe", "embed", "iter", "maps", "slices",
]);

// ── Types ───────────────────────────────────────────────────────────────────

/** Per-file facts the model builder needs, however they were derived. */
export interface ScanFileMeta {
  path: string;
  lineCount: number;
  language: string;
  /** Visual kind hint, from path conventions. */
  kind: string;
}

export interface ScanZone {
  id: string;
  name: string;
  files: string[];
  entryPoints: string[];
  cohesion: number;
  coupling: number;
  description: string;
  insights: string[];
}

export interface ScanResult {
  zones: ScanZone[];
  crossings: Array<{ fromZone: string; toZone: string }>;
  fileMeta: Map<string, ScanFileMeta>;
  external: Array<{ package: string; importedBy: string[] }>;
  totalFiles: number;
  totalLines: number;
  /** Aliases that were resolved, for the gap report. */
  aliasCount: number;
}

// ── Walking ─────────────────────────────────────────────────────────────────

/** Directory names a .gitignore asks us to skip. Deliberately naive. */
function extraSkips(dir: string): Set<string> {
  const skips = new Set<string>();
  const path = join(dir, ".gitignore");
  if (!existsSync(path)) return skips;
  try {
    for (const raw of readFileSync(path, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      if (line.includes("*") || line.includes("?")) continue;
      const name = line.replace(/^\/+/, "").replace(/\/+$/, "");
      if (name && !name.includes("/")) skips.add(name);
    }
  } catch {
    /* an unreadable .gitignore is not worth failing over */
  }
  return skips;
}

interface WalkedFile {
  path: string;
  ext: string;
}

export function walkSources(root: string): WalkedFile[] {
  const skip = new Set([...SKIP_DIRS, ...extraSkips(root)]);
  const files: WalkedFile[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sorted so the scan is reproducible regardless of filesystem order.
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (!LANGUAGES[ext]) continue;
        try {
          if (statSync(full).size > 2_000_000) continue; // generated bundle, not source
        } catch {
          continue;
        }
        files.push({ path: relative(root, full).split(sep).join("/"), ext });
      }
    }
  }

  walk(root, 0);
  return files;
}

// ── Import extraction ───────────────────────────────────────────────────────

const JS_PATTERNS = [
  /\bimport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const PY_PATTERNS = [
  /^\s*from\s+([.\w]+)\s+import\s+/gm,
  /^\s*import\s+([.\w]+)/gm,
];
const GO_SINGLE = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm;
const GO_BLOCK = /^\s*import\s*\(([\s\S]*?)^\s*\)/gm;
const GO_BLOCK_ENTRY = /^\s*(?:[\w.]+\s+)?"([^"]+)"/gm;

/** Go imports only count inside `import "x"` or an `import ( ... )` block. */
function extractGoSpecs(content: string): Set<string> {
  const specs = new Set<string>();
  GO_SINGLE.lastIndex = 0;
  let match;
  while ((match = GO_SINGLE.exec(content)) !== null) specs.add(match[1]);

  GO_BLOCK.lastIndex = 0;
  while ((match = GO_BLOCK.exec(content)) !== null) {
    const body = match[1];
    GO_BLOCK_ENTRY.lastIndex = 0;
    let entry;
    while ((entry = GO_BLOCK_ENTRY.exec(body)) !== null) specs.add(entry[1]);
  }
  return specs;
}

/**
 * A module specifier, not arbitrary quoted text. Without this a stray string
 * literal sitting alone on a line becomes a phantom dependency.
 */
export function looksLikeSpec(spec: string): boolean {
  if (!spec || spec.length > 200) return false;
  return /^[@\w][\w@./~+-]*$/.test(spec) || /^[./~]/.test(spec);
}

export function extractSpecs(content: string, ext: string): string[] {
  let specs: Set<string>;
  if (ext === ".go") {
    specs = extractGoSpecs(content);
  } else {
    specs = new Set<string>();
    const patterns = ext === ".py" ? PY_PATTERNS : JS_PATTERNS;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1]) specs.add(match[1]);
      }
    }
  }
  return [...specs].filter(looksLikeSpec);
}

// ── Resolution ──────────────────────────────────────────────────────────────

const RESOLVE_EXTS = [
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".go", ".vue", ".svelte",
];

/** Resolve a project-relative module path to a known file, or null. */
function resolvePath(base: string, fileSet: Set<string>): string | null {
  // A ".js" specifier in a TypeScript project resolves to the ".ts" source.
  const stripped = base.replace(/\.(js|mjs|cjs)$/, "");
  for (const ext of RESOLVE_EXTS) {
    for (const candidate of [base + ext, stripped + ext, `${base}/index${ext}`, `${stripped}/index${ext}`]) {
      const normal = candidate.replace(/\/\.\//g, "/").replace(/^\.\//, "");
      if (fileSet.has(normal)) return normal;
    }
  }
  return null;
}

function resolveRelative(fromFile: string, spec: string, fileSet: Set<string>): string | null {
  return resolvePath(join(dirname(fromFile), spec).split(sep).join("/"), fileSet);
}

export function isStdlib(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  return STDLIB.has(spec.split("/")[0]);
}

/** Trim a package specifier to its installable name. */
export function packageName(spec: string): string {
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  // npm scope: @scope/name
  if (spec.startsWith("@") && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  // Go module path: host/owner/repo — the first segment alone is just a host.
  if (parts.length >= 3 && parts[0].includes(".")) return parts.slice(0, 3).join("/");
  return parts[0];
}

// ── Alias maps ──────────────────────────────────────────────────────────────

/**
 * Non-relative specifiers that still point inside the repository.
 *
 * Two sources, both common enough that ignoring them leaves whole packages
 * looking like third-party dependencies:
 *   - `compilerOptions.paths` in tsconfig.json (`@app/*` -> `src/*`)
 *   - workspace packages, whose `name` in package.json maps to their directory
 */
export interface AliasMap {
  /** Exact or prefix alias -> project-relative directory prefix. */
  prefixes: Array<{ from: string; to: string }>;
}

function readJsonLoose(path: string): unknown | null {
  try {
    const raw = readFileSync(path, "utf-8")
      // tsconfig.json is routinely JSONC.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function buildAliasMap(root: string, files: WalkedFile[]): AliasMap {
  const prefixes: Array<{ from: string; to: string }> = [];

  // 1. tsconfig paths
  for (const name of ["tsconfig.json", "tsconfig.base.json", "jsconfig.json"]) {
    const config = readJsonLoose(join(root, name)) as
      | { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
      | null;
    const paths = config?.compilerOptions?.paths;
    if (!paths) continue;
    const baseUrl = (config?.compilerOptions?.baseUrl ?? ".").replace(/^\.\//, "").replace(/\/$/, "");
    for (const [alias, targets] of Object.entries(paths)) {
      const target = targets?.[0];
      if (!target) continue;
      // Strip the wildcard AND any trailing slash: "@app/*" becomes "@app", so
      // the prefix test below can append its own separator without doubling it.
      const from = alias.replace(/\*$/, "").replace(/\/$/, "");
      let to = target.replace(/\*$/, "").replace(/^\.\//, "");
      if (baseUrl && baseUrl !== ".") to = `${baseUrl}/${to}`;
      prefixes.push({ from, to: to.replace(/\/$/, "") });
    }
  }

  // 2. Workspace package names -> their directories. Derived from the packages
  //    actually present rather than from a workspace glob, so it works for npm,
  //    pnpm and yarn workspaces alike.
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length >= 2 && WORKSPACE_CONTAINERS.has(parts[0])) {
      dirs.add(`${parts[0]}/${parts[1]}`);
    }
  }
  for (const dir of [...dirs].sort()) {
    const pkg = readJsonLoose(join(root, dir, "package.json")) as { name?: string } | null;
    if (pkg?.name) prefixes.push({ from: pkg.name, to: dir });
  }

  // Longest alias first so `@app/ui` wins over `@app/`.
  prefixes.sort((a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from));
  return { prefixes };
}

/**
 * Resolve an aliased specifier to a file. Workspace packages usually resolve to
 * their published entry point, so a bare package name falls back to the
 * package's source root rather than failing outright.
 */
function resolveAlias(
  spec: string,
  aliases: AliasMap,
  fileSet: Set<string>,
  dirRep: Map<string, string>,
): string | null {
  for (const { from, to } of aliases.prefixes) {
    if (spec !== from && !spec.startsWith(`${from}/`)) continue;
    const rest = spec.slice(from.length).replace(/^\//, "");
    const base = rest ? `${to}/${rest}` : to;
    const direct = resolvePath(base, fileSet);
    if (direct) return direct;
    // Bare package reference: aim at its source root, then the directory itself.
    for (const candidate of [`${to}/src`, to]) {
      const rep = dirRep.get(candidate);
      if (rep) return rep;
      const viaIndex = resolvePath(`${candidate}/index`, fileSet);
      if (viaIndex) return viaIndex;
    }
    return null;
  }
  return null;
}

/**
 * A Go module's own path, from go.mod. Go has no relative imports — a package
 * refers to its siblings by the full module path — so without this every
 * intra-module import looks external and the map has no internal edges at all.
 */
function goModulePath(root: string): string | null {
  const path = join(root, "go.mod");
  if (!existsSync(path)) return null;
  try {
    const match = readFileSync(path, "utf-8").match(/^\s*module\s+(\S+)/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Zone grouping ───────────────────────────────────────────────────────────

const MAX_ZONE_FILES = 90;
const MIN_ZONE_FILES = 3;

/**
 * Choose a zone key for a path.
 *
 * The heuristic mirrors how people actually organise repositories: a workspace
 * container means the package name is the unit; a conventional source root
 * means the directory below it is; otherwise the top-level directory is.
 */
export function zoneKeyFor(path: string, depthBoost: number): string {
  const parts = path.split("/");
  if (parts.length === 1) return "(root)";

  let take = 1;
  if (WORKSPACE_CONTAINERS.has(parts[0])) take = 2;
  else if (SOURCE_ROOTS.has(parts[0])) take = 2;

  take += depthBoost;
  // Never consume the filename itself as a zone segment.
  take = Math.min(take, parts.length - 1);
  return parts.slice(0, take).join("/") || "(root)";
}

/**
 * Group files into zones, splitting oversized groups and folding tiny ones so
 * the map has neither one giant block nor fifty specks.
 */
export function groupZones(files: WalkedFile[]): Map<string, WalkedFile[]> {
  let groups = new Map<string, WalkedFile[]>();
  for (const file of files) {
    const key = zoneKeyFor(file.path, 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(file);
  }

  // Split anything oversized one level deeper, once.
  const split = new Map<string, WalkedFile[]>();
  for (const [key, members] of groups) {
    if (members.length <= MAX_ZONE_FILES) {
      split.set(key, members);
      continue;
    }
    const sub = new Map<string, WalkedFile[]>();
    for (const file of members) {
      const subKey = zoneKeyFor(file.path, 1);
      if (!sub.has(subKey)) sub.set(subKey, []);
      sub.get(subKey)!.push(file);
    }
    // Only accept the split if it actually divides the group.
    if (sub.size > 1) for (const [k, v] of sub) split.set(k, v);
    else split.set(key, members);
  }
  groups = split;

  // Fold specks into their parent path, then into a catch-all.
  const folded = new Map<string, WalkedFile[]>();
  for (const [key, members] of groups) {
    let target = key;
    if (members.length < MIN_ZONE_FILES) {
      const parent = key.split("/").slice(0, -1).join("/");
      target = parent && groups.has(parent)
        ? parent
        : key.includes("/") ? parent || "(root)" : "(root)";
    }
    if (!folded.has(target)) folded.set(target, []);
    folded.get(target)!.push(...members);
  }

  // A handful of files sitting directly in a package root (a config, an entry
  // shim) belong with that package's source, not in a block of their own —
  // otherwise "packages/web" and "packages/web/src" both appear, both "Web".
  for (const [key, members] of [...folded]) {
    if (members.length >= MIN_ZONE_FILES * 2) continue;
    const children = [...folded.keys()].filter((k) => k !== key && k.startsWith(`${key}/`));
    if (children.length === 0) continue;
    children.sort((a, b) => folded.get(b)!.length - folded.get(a)!.length || a.localeCompare(b));
    folded.get(children[0])!.push(...members);
    folded.delete(key);
  }

  return folded;
}

/** Human-readable zone name from a path key. */
export function zoneName(key: string): string {
  if (key === "(root)") return "Root";
  const segments = key.split("/");
  // "packages/rex" reads better as "Rex"; the container adds nothing.
  const parts = segments.filter(
    (p) => !(WORKSPACE_CONTAINERS.has(p) || SOURCE_ROOTS.has(p)) || segments.length === 1,
  );
  const label = (parts.length ? parts : segments).join(" ");
  return label
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Kind inference ──────────────────────────────────────────────────────────

const KIND_HINTS: Array<[string, string[]]> = [
  ["tests", ["test", "tests", "__tests__", "spec", "specs", "e2e", "fixtures", "testing"]],
  ["entry", ["route", "routes", "api", "pages", "page", "handler", "handlers", "controller", "controllers", "endpoint", "endpoints", "cmd", "bin", "server", "cli", "main"]],
  ["ui", ["component", "components", "ui", "view", "views", "screen", "screens", "widget", "widgets", "hook", "hooks", "styles", "layout", "layouts"]],
  ["data", ["model", "models", "schema", "schemas", "store", "stores", "db", "database", "entity", "entities", "repository", "repositories", "migration", "migrations", "dao", "types"]],
  ["gateway", ["gateway", "gateways", "adapter", "adapters", "client", "clients", "integration", "integrations", "provider", "providers", "connector", "connectors"]],
  ["logic", ["service", "services", "core", "domain", "usecase", "usecases", "logic", "engine", "workflow", "workflows", "analyzer", "analyzers", "generator", "generators"]],
  ["support", ["util", "utils", "helper", "helpers", "config", "configs", "constant", "constants", "shared", "common", "lib", "internal", "support"]],
];

export function inferFileKind(path: string): string {
  const lower = path.toLowerCase();
  if (/(^|\/)(tests?|specs?|__tests__)(\/|$)/.test(lower)) return "tests";
  if (/\.(test|spec)\.[a-z]+$/.test(lower)) return "tests";
  if (/_test\.[a-z]+$/.test(lower)) return "tests";

  const segments = lower.split("/").slice(0, -1);
  for (const [kind, words] of KIND_HINTS) {
    for (const segment of segments) {
      if (words.includes(segment)) return kind;
    }
  }
  const file = basename(lower, extname(lower));
  for (const [kind, words] of KIND_HINTS) {
    if (words.includes(file)) return kind;
  }
  return "support";
}

// ── Scan ────────────────────────────────────────────────────────────────────

export function scanProject(root: string): ScanResult {
  const files = walkSources(root);
  if (files.length === 0) {
    return {
      zones: [], crossings: [], fileMeta: new Map(), external: [],
      totalFiles: 0, totalLines: 0, aliasCount: 0,
    };
  }

  const fileSet = new Set(files.map((f) => f.path));
  const goModule = goModulePath(root);

  // Directory -> a representative file, for specs naming a package directory.
  // Files arrive sorted, so the representative is stable across runs.
  const dirRep = new Map<string, string>();
  for (const file of files) {
    const dir = file.path.split("/").slice(0, -1).join("/");
    if (!dirRep.has(dir)) dirRep.set(dir, file.path);
  }

  const aliases = buildAliasMap(root, files);

  const meta = new Map<string, ScanFileMeta>();
  const edges: Array<{ from: string; to: string }> = [];
  const externalUsers = new Map<string, Set<string>>();
  let aliasCount = 0;

  for (const file of files) {
    let content = "";
    try {
      content = readFileSync(join(root, file.path), "utf-8");
    } catch {
      content = "";
    }
    meta.set(file.path, {
      path: file.path,
      lineCount: content ? content.split("\n").length : 0,
      language: LANGUAGES[file.ext] ?? "Other",
      kind: inferFileKind(file.path),
    });

    for (const spec of extractSpecs(content, file.ext)) {
      // 1. Go intra-module import
      if (goModule && (spec === goModule || spec.startsWith(`${goModule}/`))) {
        const inner = spec.slice(goModule.length).replace(/^\//, "");
        const target = dirRep.get(inner);
        if (target && target !== file.path) edges.push({ from: file.path, to: target });
        continue;
      }
      // 2. Relative import
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~")) {
        const target = resolveRelative(file.path, spec, fileSet);
        if (target && target !== file.path) edges.push({ from: file.path, to: target });
        continue;
      }
      // 3. tsconfig path alias or workspace package
      const aliased = resolveAlias(spec, aliases, fileSet, dirRep);
      if (aliased) {
        aliasCount++;
        if (aliased !== file.path) edges.push({ from: file.path, to: aliased });
        continue;
      }
      // 4. Third party (standard library excluded)
      if (!isStdlib(spec)) {
        const pkg = packageName(spec);
        if (!externalUsers.has(pkg)) externalUsers.set(pkg, new Set());
        externalUsers.get(pkg)!.add(file.path);
      }
    }
  }

  // ── Zones ────────────────────────────────────────────────────────────────

  const groups = groupZones(files);
  const zoneOf = new Map<string, string>();
  const zones: ScanZone[] = [];

  const nameCounts = new Map<string, number>();
  for (const key of groups.keys()) {
    const name = zoneName(key);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  for (const [key, members] of [...groups.entries()].sort()) {
    const paths = members.map((m) => m.path).sort();
    for (const p of paths) zoneOf.set(p, key);
    // Two directories can prettify to the same label; fall back to the full
    // path so the map never shows two identically named blocks.
    const short = zoneName(key);
    const name = (nameCounts.get(short) ?? 0) > 1 ? key : short;
    zones.push({
      id: key, name, files: paths, entryPoints: [],
      cohesion: 0, coupling: 0, description: "", insights: [],
    });
  }

  const crossings: Array<{ fromZone: string; toZone: string }> = [];
  const internal = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const zone of zones) {
    internal.set(zone.id, 0);
    outgoing.set(zone.id, 0);
  }
  for (const edge of edges) {
    const from = zoneOf.get(edge.from);
    const to = zoneOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from === to) internal.set(from, internal.get(from)! + 1);
    else {
      outgoing.set(from, outgoing.get(from)! + 1);
      crossings.push({ fromZone: from, toZone: to });
    }
  }

  const inbound = new Set(edges.map((e) => e.to));
  for (const zone of zones) {
    const inside = internal.get(zone.id)!;
    const out = outgoing.get(zone.id)!;
    const total = inside + out;
    zone.cohesion = total === 0 ? 0 : Math.round((inside / total) * 100) / 100;
    zone.coupling = total === 0 ? 0 : Math.round((out / total) * 100) / 100;
    zone.entryPoints = zone.files.filter((f) => !inbound.has(f)).slice(0, 6);
    const langs = new Map<string, number>();
    for (const f of zone.files) {
      const lang = meta.get(f)!.language;
      langs.set(lang, (langs.get(lang) ?? 0) + 1);
    }
    const topLang = [...langs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    zone.description = `${zone.files.length} files, primarily ${topLang ? topLang[0] : "Other"}`;
  }

  const external = [...externalUsers.entries()]
    .map(([pkg, users]) => ({ package: pkg, importedBy: [...users].sort() }))
    .sort((a, b) => b.importedBy.length - a.importedBy.length || a.package.localeCompare(b.package));

  return {
    zones,
    crossings,
    fileMeta: meta,
    external,
    totalFiles: files.length,
    totalLines: [...meta.values()].reduce((sum, m) => sum + m.lineCount, 0),
    aliasCount,
  };
}

/** Resolve a directory argument to an absolute path. */
export function resolveRoot(dir: string): string {
  return resolve(dir);
}
