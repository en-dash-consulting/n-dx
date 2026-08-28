#!/usr/bin/env node
/**
 * iso-map — render a standalone isometric map of a codebase.
 *
 * Zero dependencies, single file, Node 18+. Two input paths:
 *
 *   1. If `.sourcevision/` exists, its zones, inventory and import graph are
 *      used directly — that analysis is better than anything this script can do
 *      in a single pass.
 *   2. Otherwise the project is scanned here: source files are walked, grouped
 *      into zones by directory structure, and imports are extracted by regex.
 *
 * Either way the output is one self-contained HTML file that fetches nothing at
 * runtime.
 *
 * Usage:
 *   node iso-map.mjs [dir] [options]
 *
 *   --out=<path>        Output file (default: <dir>/iso-map.html)
 *   --max-nodes=<n>     Cap drawn zones, largest first (default 40)
 *   --no-externals      Omit the shared third-party dependency column
 *   --source=<mode>     auto | sourcevision | scan   (default auto)
 *   --title=<text>      Override the page title
 *   --json              Also print the model as JSON to stdout
 *   --help
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, dirname, extname, basename, sep } from "node:path";

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    dir: ".",
    out: null,
    maxNodes: 40,
    externals: true,
    source: "auto",
    title: null,
    json: false,
    help: false,
  };
  let sawDir = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--no-externals") opts.externals = false;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--out=")) opts.out = arg.slice(6);
    else if (arg.startsWith("--title=")) opts.title = arg.slice(8);
    else if (arg.startsWith("--source=")) opts.source = arg.slice(9);
    else if (arg.startsWith("--max-nodes=")) {
      const n = Number.parseInt(arg.slice(12), 10);
      if (!Number.isFinite(n) || n < 1) fail(`Invalid --max-nodes: ${arg.slice(12)}`);
      opts.maxNodes = n;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}`);
    } else if (!sawDir) {
      opts.dir = arg;
      sawDir = true;
    }
  }
  if (!["auto", "sourcevision", "scan"].includes(opts.source)) {
    fail(`Invalid --source: ${opts.source} (expected auto, sourcevision or scan)`);
  }
  return opts;
}

function fail(message) {
  process.stderr.write(`iso-map: ${message}\n`);
  process.exit(1);
}

const HELP = `iso-map — standalone isometric map of a codebase

  node iso-map.mjs [dir] [options]

  --out=<path>       Output file (default: <dir>/iso-map.html)
  --max-nodes=<n>    Cap drawn zones, largest first (default 40)
  --no-externals     Omit the shared third-party dependency column
  --source=<mode>    auto | sourcevision | scan (default auto)
  --title=<text>     Override the page title
  --json             Print the model as JSON to stdout as well
  --help

Uses .sourcevision/ output when present; otherwise scans the project directly.
`;

// ── Scanner: language and directory knowledge ───────────────────────────────

const LANGUAGES = {
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
  ".idea", ".vscode", ".terraform", "tmp", "temp", ".DS_Store", "site-packages",
]);

/** Directories that contain workspaces rather than being one themselves. */
const WORKSPACE_CONTAINERS = new Set([
  "packages", "apps", "services", "libs", "modules", "projects", "crates",
]);

/** Directories that hold source but are not meaningful zone names alone. */
const SOURCE_ROOTS = new Set([
  "src", "lib", "app", "source", "internal", "pkg", "cmd",
]);

// ── Scanner: walk ───────────────────────────────────────────────────────────

/** Read the directory names a .gitignore asks us to skip. Deliberately naive. */
function extraSkips(dir) {
  const skips = new Set();
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

function walkSources(root) {
  const skip = new Set([...SKIP_DIRS, ...extraSkips(root)]);
  const files = [];

  function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (!LANGUAGES[ext]) continue;
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          continue;
        }
        if (size > 2_000_000) continue; // generated bundle, not source
        files.push({ path: relative(root, full).split(sep).join("/"), ext, size });
      }
    }
  }

  walk(root, 0);
  return files;
}

// ── Scanner: imports ────────────────────────────────────────────────────────

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
function extractGoSpecs(content) {
  const specs = new Set();
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
 * literal that happens to sit alone on a line becomes a phantom dependency.
 */
function looksLikeSpec(spec) {
  if (!spec || spec.length > 200) return false;
  return /^[@\w][\w@./~+-]*$/.test(spec) || /^[./~]/.test(spec);
}

function extractSpecs(content, ext) {
  let specs;
  if (ext === ".go") {
    specs = extractGoSpecs(content);
  } else {
    specs = new Set();
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

const RESOLVE_EXTS = [
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".go", ".vue", ".svelte",
];

/** Resolve a relative import spec to a known file path, or null. */
function resolveRelative(fromFile, spec, fileSet) {
  const base = join(dirname(fromFile), spec).split(sep).join("/");
  const candidates = [];
  // A ".js" specifier in a TypeScript project resolves to the ".ts" source.
  const stripped = base.replace(/\.(js|mjs|cjs)$/, "");
  for (const ext of RESOLVE_EXTS) {
    candidates.push(base + ext, stripped + ext);
    candidates.push(`${base}/index${ext}`, `${stripped}/index${ext}`);
  }
  for (const candidate of candidates) {
    const normal = candidate.replace(/\/\.\//g, "/").replace(/^\.\//, "");
    if (fileSet.has(normal)) return normal;
  }
  return null;
}

/**
 * Standard-library modules. They are imports, but "everything depends on fs" is
 * not an architectural insight, so they are kept out of the dependency column.
 */
/**
 * A Go module's own path, from go.mod. Go has no relative imports — a package
 * refers to its own siblings by the full module path — so without this every
 * intra-module import looks external and the map has no internal edges at all.
 */
function goModulePath(root) {
  const path = join(root, "go.mod");
  if (!existsSync(path)) return null;
  try {
    const match = readFileSync(path, "utf-8").match(/^\s*module\s+(\S+)/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

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

function isStdlib(spec) {
  if (spec.startsWith("node:")) return true;
  const head = spec.split("/")[0];
  return STDLIB.has(head);
}

function isExternalSpec(spec) {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~")) return false;
  return !isStdlib(spec);
}

/** Trim a package specifier to its installable name. */
function packageName(spec) {
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  // npm scope: @scope/name
  if (spec.startsWith("@") && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  // Go module path: host/owner/repo — the first segment alone is just a host.
  if (parts.length >= 3 && parts[0].includes(".")) return parts.slice(0, 3).join("/");
  return parts[0];
}

// ── Scanner: zone grouping ──────────────────────────────────────────────────

/**
 * Choose a zone key for a path.
 *
 * The heuristic mirrors how people actually organise repositories: a workspace
 * container means the package name is the unit; a conventional source root
 * means the directory below it is; otherwise the top-level directory is.
 */
function zoneKeyFor(path, depthBoost) {
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
 * Group files into zones, splitting oversized groups and folding tiny ones into
 * their parent so the map has neither one giant block nor fifty specks.
 */
function groupZones(files) {
  const MAX_ZONE_FILES = 90;
  const MIN_ZONE_FILES = 3;

  let groups = new Map();
  for (const file of files) {
    const key = zoneKeyFor(file.path, 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }

  // Split anything oversized one level deeper, once.
  const split = new Map();
  for (const [key, members] of groups) {
    if (members.length <= MAX_ZONE_FILES) {
      split.set(key, members);
      continue;
    }
    const sub = new Map();
    for (const file of members) {
      const subKey = zoneKeyFor(file.path, 1);
      if (!sub.has(subKey)) sub.set(subKey, []);
      sub.get(subKey).push(file);
    }
    // Only accept the split if it actually divides the group.
    if (sub.size > 1) for (const [k, v] of sub) split.set(k, v);
    else split.set(key, members);
  }
  groups = split;

  // Fold specks into their parent path, then into a catch-all.
  const folded = new Map();
  for (const [key, members] of groups) {
    let target = key;
    if (members.length < MIN_ZONE_FILES) {
      const parent = key.split("/").slice(0, -1).join("/");
      target = parent && groups.has(parent) ? parent : key.includes("/") ? parent || "(root)" : "(root)";
    }
    if (!folded.has(target)) folded.set(target, []);
    folded.get(target).push(...members);
  }

  // A handful of files sitting directly in a package root (a config, an entry
  // shim) belong with that package's source, not in a block of their own —
  // otherwise "packages/web" and "packages/web/src" both appear, both named
  // "Web".
  for (const [key, members] of [...folded]) {
    if (members.length >= MIN_ZONE_FILES * 2) continue;
    const children = [...folded.keys()].filter((k) => k !== key && k.startsWith(`${key}/`));
    if (children.length === 0) continue;
    children.sort((a, b) => folded.get(b).length - folded.get(a).length || a.localeCompare(b));
    folded.get(children[0]).push(...members);
    folded.delete(key);
  }

  return folded;
}

/** Human-readable zone name from a path key. */
function zoneName(key) {
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

// ── Scanner: kind inference ─────────────────────────────────────────────────

const KIND_HINTS = [
  ["tests", ["test", "tests", "__tests__", "spec", "specs", "e2e", "fixtures", "testing"]],
  ["entry", ["route", "routes", "api", "pages", "page", "handler", "handlers", "controller", "controllers", "endpoint", "endpoints", "cmd", "bin", "server", "cli", "main"]],
  ["ui", ["component", "components", "ui", "view", "views", "screen", "screens", "widget", "widgets", "hook", "hooks", "styles", "layout", "layouts"]],
  ["data", ["model", "models", "schema", "schemas", "store", "stores", "db", "database", "entity", "entities", "repository", "repositories", "migration", "migrations", "dao", "types"]],
  ["gateway", ["gateway", "gateways", "adapter", "adapters", "client", "clients", "integration", "integrations", "provider", "providers", "connector", "connectors"]],
  ["logic", ["service", "services", "core", "domain", "usecase", "usecases", "logic", "engine", "workflow", "workflows", "analyzer", "analyzers", "generator", "generators"]],
  ["support", ["util", "utils", "helper", "helpers", "config", "configs", "constant", "constants", "shared", "common", "lib", "internal", "support"]],
];

function inferFileKind(path) {
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

// ── Scanner: assemble model input ───────────────────────────────────────────

function scanProject(root) {
  const files = walkSources(root);
  if (files.length === 0) {
    fail(`No source files found under ${root}. Is this the right directory?`);
  }

  const fileSet = new Set(files.map((f) => f.path));
  const goModule = goModulePath(root);
  // Directory -> a representative file, for import specs that name a package
  // directory rather than a file.
  const dirRep = new Map();
  for (const file of files) {
    const dir = file.path.split("/").slice(0, -1).join("/");
    if (!dirRep.has(dir)) dirRep.set(dir, file.path);
  }
  const meta = new Map();
  const edges = [];
  const externalUsers = new Map(); // package -> Set<file>

  for (const file of files) {
    let content = "";
    try {
      content = readFileSync(join(root, file.path), "utf-8");
    } catch {
      content = "";
    }
    const lineCount = content ? content.split("\n").length : 0;
    meta.set(file.path, {
      path: file.path,
      lineCount,
      language: LANGUAGES[file.ext] || "Other",
      kind: inferFileKind(file.path),
    });

    for (const spec of extractSpecs(content, file.ext)) {
      if (goModule && (spec === goModule || spec.startsWith(`${goModule}/`))) {
        const inner = spec.slice(goModule.length).replace(/^\//, "");
        const target = dirRep.get(inner);
        if (target && target !== file.path) edges.push({ from: file.path, to: target });
        continue;
      }
      if (isExternalSpec(spec)) {
        const pkg = packageName(spec);
        if (!externalUsers.has(pkg)) externalUsers.set(pkg, new Set());
        externalUsers.get(pkg).add(file.path);
      } else {
        const target = resolveRelative(file.path, spec, fileSet);
        if (target && target !== file.path) edges.push({ from: file.path, to: target });
      }
    }
  }

  const groups = groupZones(files);
  const zoneOf = new Map();
  const zones = [];

  const nameCounts = new Map();
  for (const key of groups.keys()) {
    const name = zoneName(key);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  for (const [key, members] of [...groups.entries()].sort()) {
    const paths = members.map((m) => m.path).sort();
    for (const p of paths) zoneOf.set(p, key);
    // Two directories can prettify to the same label ("packages/web" and
    // "packages/web/src" both become "Web"); fall back to the full path so the
    // map never shows two identically named blocks.
    const short = zoneName(key);
    const name = nameCounts.get(short) > 1 ? key : short;
    zones.push({ id: key, name, files: paths });
  }

  // Cross-zone edges, plus per-zone internal/outgoing counts for cohesion.
  const crossings = [];
  const internal = new Map();
  const outgoing = new Map();
  for (const zone of zones) {
    internal.set(zone.id, 0);
    outgoing.set(zone.id, 0);
  }
  for (const edge of edges) {
    const from = zoneOf.get(edge.from);
    const to = zoneOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from === to) internal.set(from, internal.get(from) + 1);
    else {
      outgoing.set(from, outgoing.get(from) + 1);
      crossings.push({ fromZone: from, toZone: to });
    }
  }

  const inbound = new Set(edges.map((e) => e.to));
  for (const zone of zones) {
    const inside = internal.get(zone.id);
    const out = outgoing.get(zone.id);
    const total = inside + out;
    zone.cohesion = total === 0 ? 0 : round2(inside / total);
    zone.coupling = total === 0 ? 0 : round2(out / total);
    zone.entryPoints = zone.files.filter((f) => !inbound.has(f)).slice(0, 6);
    const langs = new Map();
    for (const f of zone.files) {
      const lang = meta.get(f).language;
      langs.set(lang, (langs.get(lang) || 0) + 1);
    }
    const topLang = [...langs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    zone.description = `${zone.files.length} files, primarily ${topLang ? topLang[0] : "Other"}`;
    zone.insights = [];
  }

  const external = [...externalUsers.entries()]
    .map(([pkg, users]) => ({ package: pkg, importedBy: [...users].sort() }))
    .sort((a, b) => b.importedBy.length - a.importedBy.length || a.package.localeCompare(b.package));

  return {
    zones,
    crossings,
    findings: [],
    fileMeta: meta,
    external,
    projectName: basename(resolve(root)),
    analyzedAt: new Date().toISOString(),
    origin: "scan",
    totalFiles: files.length,
    totalLines: [...meta.values()].reduce((sum, m) => sum + m.lineCount, 0),
  };
}

// ── Sourcevision input ──────────────────────────────────────────────────────

function loadSourcevision(root) {
  const svDir = join(root, ".sourcevision");
  const need = ["zones.json", "inventory.json", "imports.json"];
  if (!existsSync(svDir) || need.some((f) => !existsSync(join(svDir, f)))) return null;

  const read = (name) => JSON.parse(readFileSync(join(svDir, name), "utf-8"));
  let zonesData, inventory, imports;
  try {
    zonesData = read("zones.json");
    inventory = read("inventory.json");
    imports = read("imports.json");
  } catch {
    return null;
  }

  let classifications = null;
  try {
    if (existsSync(join(svDir, "classifications.json"))) classifications = read("classifications.json");
  } catch { /* optional */ }

  let manifest = null;
  try {
    if (existsSync(join(svDir, "manifest.json"))) manifest = read("manifest.json");
  } catch { /* optional */ }

  const ARCHETYPE_KIND = {
    entrypoint: "entry", "route-handler": "entry", page: "entry",
    "cli-command": "logic", service: "logic", middleware: "logic",
    store: "data", schema: "data", types: "data", model: "data",
    component: "ui", hook: "ui", view: "ui",
    gateway: "gateway", adapter: "gateway", client: "gateway",
    utility: "support", config: "support", "test-helper": "support",
  };

  const archetypeOf = new Map();
  for (const entry of classifications?.files ?? []) {
    if (entry.archetype) archetypeOf.set(entry.path, entry.archetype);
  }

  const meta = new Map();
  for (const file of inventory.files) {
    const archetype = archetypeOf.get(file.path);
    const kind = file.role === "test"
      ? "tests"
      : archetype
        ? (ARCHETYPE_KIND[archetype] ?? "support")
        : "support";
    meta.set(file.path, {
      path: file.path,
      lineCount: file.lineCount ?? 0,
      language: file.language ?? "Other",
      kind,
    });
  }

  const zones = (zonesData.zones ?? [])
    .filter((z) => z.files?.length > 0 && z.detectionQuality !== "artifact")
    .map((z) => ({
      id: z.id,
      name: z.name,
      files: z.files,
      entryPoints: z.entryPoints ?? [],
      cohesion: z.cohesion ?? 0,
      coupling: z.coupling ?? 0,
      description: z.description ?? "",
      insights: z.insights ?? [],
      riskLevel: z.riskMetrics?.riskLevel,
    }));

  return {
    zones,
    crossings: (zonesData.crossings ?? []).map((c) => ({ fromZone: c.fromZone, toZone: c.toZone })),
    findings: zonesData.findings ?? [],
    fileMeta: meta,
    external: (imports.external ?? []).map((e) => ({ package: e.package, importedBy: e.importedBy ?? [] })),
    projectName: basename(resolve(root)),
    analyzedAt: manifest?.analyzedAt ?? new Date().toISOString(),
    gitBranch: manifest?.gitBranch,
    origin: "sourcevision",
    totalFiles: inventory.summary?.totalFiles ?? inventory.files.length,
    totalLines: inventory.summary?.totalLines ?? 0,
  };
}

// ── Model: shared geometry ──────────────────────────────────────────────────

const ISO_KINDS = [
  { id: "entry", label: "Entry points", color: "#4F9BE8" },
  { id: "logic", label: "Business logic", color: "#7FAE33" },
  { id: "data", label: "Data & schema", color: "#C06BD4" },
  { id: "ui", label: "User interface", color: "#E0A33E" },
  { id: "gateway", label: "Gateways", color: "#3FB6A8" },
  { id: "support", label: "Support & config", color: "#6F7BA6" },
  { id: "tests", label: "Tests", color: "#4E5B78" },
  { id: "external", label: "Outside the codebase", color: "#7C879B" },
];

const GAP_U = 5, GAP_V = 2;
const MIN_W = 3, MAX_W = 9, MIN_D = 3, MAX_D = 7, MIN_H = 1.2, MAX_H = 6.5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;
const fmt = (n) => Number(n).toLocaleString("en-US");

function scaleHeight(lines, minLines, maxLines) {
  if (maxLines <= 0) return MIN_H;
  const lo = Math.log10(Math.max(minLines, 1) + 1);
  const hi = Math.log10(Math.max(maxLines, 1) + 1);
  if (hi - lo < 1e-9) return round2((MIN_H + MAX_H) / 2);
  const t = (Math.log10(Math.max(lines, 1) + 1) - lo) / (hi - lo);
  return round2(MIN_H + clamp(t, 0, 1) * (MAX_H - MIN_H));
}

/**
 * Longest-path layering with DFS back-edge removal. Import graphs contain
 * cycles; without removing them first, one cycle stretches the map to the node
 * count. Back edges still render, through a lane below the scene.
 */
function assignLayers(nodeIds, edges) {
  const ids = [...nodeIds].sort();
  const adjacency = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!adjacency.has(e.from) || !adjacency.has(e.to) || e.from === e.to) continue;
    adjacency.get(e.from).push(e.to);
  }
  for (const list of adjacency.values()) list.sort();

  const back = new Set();
  const state = new Map(ids.map((id) => [id, 0]));
  for (const root of ids) {
    if (state.get(root) !== 0) continue;
    const stack = [{ id: root, i: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = adjacency.get(frame.id);
      if (frame.i >= next.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const to = next[frame.i++];
      const s = state.get(to);
      if (s === 1) back.add(`${frame.id}\t${to}`);
      else if (s === 0) {
        state.set(to, 1);
        stack.push({ id: to, i: 0 });
      }
    }
  }

  const incoming = new Map(ids.map((id) => [id, []]));
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      if (back.has(`${from}\t${to}`)) continue;
      incoming.get(to).push(from);
    }
  }

  const layer = new Map();
  const visiting = new Set();
  function depth(id) {
    if (layer.has(id)) return layer.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const from of incoming.get(id)) best = Math.max(best, depth(from) + 1);
    visiting.delete(id);
    layer.set(id, best);
    return best;
  }
  for (const id of ids) depth(id);
  return layer;
}

function orderRows(nodes, edges) {
  const byCol = new Map();
  for (const n of nodes) {
    if (!byCol.has(n.col)) byCol.set(n.col, []);
    byCol.get(n.col).push(n);
  }
  const preds = new Map();
  for (const e of edges) {
    if (!preds.has(e.to)) preds.set(e.to, []);
    preds.get(e.to).push(e.from);
  }
  const rowOf = new Map();
  for (const col of [...byCol.keys()].sort((a, b) => a - b)) {
    const layer = byCol.get(col);
    const bary = (n) => {
      const rows = (preds.get(n.id) ?? []).map((id) => rowOf.get(id)).filter((r) => r !== undefined);
      return rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : Number.MAX_SAFE_INTEGER;
    };
    layer.sort((a, b) => {
      const d = bary(a) - bary(b);
      if (d !== 0) return d;
      return b.metrics.files - a.metrics.files || a.id.localeCompare(b.id);
    });
    layer.forEach((n, i) => {
      n.row = i;
      rowOf.set(n.id, i);
    });
  }
}

function placeOnGrid(nodes) {
  const colW = new Map(), rowD = new Map();
  for (const n of nodes) {
    colW.set(n.col, Math.max(colW.get(n.col) ?? 0, n.w));
    rowD.set(n.row, Math.max(rowD.get(n.row) ?? 0, n.d));
  }
  const colOff = new Map();
  let u = 0;
  for (const c of [...colW.keys()].sort((a, b) => a - b)) {
    colOff.set(c, u);
    u += colW.get(c) + GAP_U;
  }
  const rowOff = new Map();
  let v = 0;
  for (const r of [...rowD.keys()].sort((a, b) => a - b)) {
    rowOff.set(r, v);
    v += rowD.get(r) + GAP_V;
  }
  for (const n of nodes) {
    n.u = colOff.get(n.col);
    n.v = rowOff.get(n.row);
  }
}

function routeEdge(a, b, bounds) {
  const av = round2(a.v + a.d / 2), bv = round2(b.v + b.d / 2);
  if (b.col > a.col) {
    const exit = a.u + a.w, entry = b.u;
    if (av === bv) return [[exit, av], [entry, bv]];
    const mid = round2(exit + (entry - exit) / 2);
    return [[exit, av], [mid, av], [mid, bv], [entry, bv]];
  }
  const lane = round2(bounds.vMax + 2 + (a.row % 3) * 0.8);
  const ax = round2(a.u + a.w / 2), bx = round2(b.u + b.w / 2);
  return [[ax, a.v + a.d], [ax, lane], [bx, lane], [bx, b.v + b.d]];
}

// ── Model: build ────────────────────────────────────────────────────────────

function buildModel(input, opts) {
  const maxNodes = opts.maxNodes;
  const { fileMeta } = input;

  const ranked = [...input.zones].sort(
    (a, b) => b.files.length - a.files.length || a.id.localeCompare(b.id),
  );
  const selected = ranked.slice(0, maxNodes);
  const omitted = ranked.slice(maxNodes).map((z) => z.name);
  const selectedIds = new Set(selected.map((z) => z.id));
  const zoneById = new Map(selected.map((z) => [z.id, z]));

  const zoneOfFile = new Map();
  for (const zone of selected) for (const f of zone.files) zoneOfFile.set(f, zone.id);

  // Aggregates
  const agg = new Map();
  for (const zone of selected) {
    let lines = 0;
    const kinds = new Map();
    for (const f of zone.files) {
      const m = fileMeta.get(f);
      if (!m) continue;
      lines += m.lineCount;
      kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
    }
    agg.set(zone.id, { lines, kinds });
  }

  // Cross-zone edge weights
  const weights = new Map();
  for (const c of input.crossings) {
    if (c.fromZone === c.toZone) continue;
    if (!selectedIds.has(c.fromZone) || !selectedIds.has(c.toZone)) continue;
    const key = `${c.fromZone}\t${c.toZone}`;
    const found = weights.get(key);
    if (found) found.weight += 1;
    else weights.set(key, { from: c.fromZone, to: c.toZone, weight: 1 });
  }
  const rawEdges = [...weights.values()].sort(
    (a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );

  const layers = assignLayers(selected.map((z) => z.id), rawEdges);

  // Externals consumed by two or more zones
  const externalPicks = [];
  if (opts.externals) {
    const scored = input.external
      .map((e) => {
        const consumers = new Set();
        for (const f of e.importedBy) {
          const z = zoneOfFile.get(f);
          if (z) consumers.add(z);
        }
        return { pkg: e.package, consumers: [...consumers].sort() };
      })
      .filter((e) => e.consumers.length >= 2)
      .sort((a, b) => b.consumers.length - a.consumers.length || a.pkg.localeCompare(b.pkg))
      .slice(0, 5);
    for (const e of scored) {
      externalPicks.push({ id: `ext:${e.pkg}`, name: e.pkg, consumers: e.consumers });
    }
  }
  const shift = externalPicks.length > 0 ? 1 : 0;

  const lineVals = selected.map((z) => agg.get(z.id).lines);
  const minLines = lineVals.length ? Math.min(...lineVals) : 0;
  const maxLines = lineVals.length ? Math.max(...lineVals) : 0;

  const findingsByZone = new Map();
  for (const f of input.findings ?? []) {
    if (!selectedIds.has(f.scope)) continue;
    if (!findingsByZone.has(f.scope)) findingsByZone.set(f.scope, []);
    findingsByZone.get(f.scope).push(f);
  }

  const inb = new Map(), outb = new Map();
  for (const e of rawEdges) {
    const a = zoneById.get(e.from), b = zoneById.get(e.to);
    if (!a || !b) continue;
    if (!outb.has(e.from)) outb.set(e.from, []);
    outb.get(e.from).push({ id: e.to, name: b.name, weight: e.weight });
    if (!inb.has(e.to)) inb.set(e.to, []);
    inb.get(e.to).push({ id: e.from, name: a.name, weight: e.weight });
  }

  const nodes = [];
  for (const zone of selected) {
    const a = agg.get(zone.id);
    const kindMix = [...a.kinds.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    const kind = kindMix.length ? kindMix[0][0] : "support";
    const files = zone.files.length;

    const byLines = [...zone.files].sort(
      (x, y) => (fileMeta.get(y)?.lineCount ?? 0) - (fileMeta.get(x)?.lineCount ?? 0) || x.localeCompare(y),
    );
    const keyFiles = [];
    const seen = new Set();
    for (const f of (zone.entryPoints ?? []).slice(0, 4)) {
      if (!seen.has(f)) { seen.add(f); keyFiles.push(f); }
    }
    for (const f of byLines) {
      if (keyFiles.length >= 8) break;
      if (!seen.has(f)) { seen.add(f); keyFiles.push(f); }
    }

    nodes.push({
      id: zone.id,
      name: zone.name,
      kind,
      col: (layers.get(zone.id) ?? 0) + shift,
      row: 0, u: 0, v: 0,
      w: clamp(Math.round(Math.sqrt(files) * 1.4), MIN_W, MAX_W),
      d: clamp(Math.round(Math.sqrt(files) * 1.0), MIN_D, MAX_D),
      h: scaleHeight(a.lines, minLines, maxLines),
      stage: "",
      sub: `${fmt(files)} files · ${fmt(a.lines)} lines`,
      body: zone.description || "",
      metrics: {
        files,
        lines: a.lines,
        cohesion: zone.cohesion ?? 0,
        coupling: zone.coupling ?? 0,
        riskLevel: zone.riskLevel ?? "unscored",
      },
      mix: kindMix.slice(0, 6),
      keyFiles,
      insights: zone.insights ?? [],
      findings: (findingsByZone.get(zone.id) ?? []).slice(0, 8).map((f) => ({
        text: f.text, severity: f.severity ?? "info",
      })),
      inbound: (inb.get(zone.id) ?? []).slice(0, 8),
      outbound: (outb.get(zone.id) ?? []).slice(0, 8),
    });
  }

  for (const e of externalPicks) {
    const names = e.consumers.map((id) => zoneById.get(id)?.name).filter(Boolean);
    nodes.push({
      id: e.id, name: e.name, kind: "external",
      col: 0, row: 0, u: 0, v: 0, w: MIN_W, d: MIN_D, h: MIN_H,
      stage: "", sub: `used by ${names.length} zones`,
      body: `Third-party package imported across ${names.length} zones. Nothing in this repository controls its behaviour — it is shown to make the shared dependency surface visible.`,
      metrics: { files: 0, lines: 0, cohesion: 0, coupling: 0, riskLevel: "unscored" },
      mix: [], keyFiles: [], insights: [], findings: [], inbound: [],
      outbound: names.map((name, i) => ({ id: e.consumers[i], name, weight: 1 })),
    });
  }

  orderRows(nodes, rawEdges);
  placeOnGrid(nodes);

  const layerCount = nodes.reduce((m, n) => Math.max(m, n.col), 0) + 1;
  const layerNames = [];
  for (let i = 0; i < layerCount; i++) {
    layerNames.push(shift === 1 && i === 0 ? "Dependencies" : `Layer ${i - shift + 1}`);
  }
  for (const n of nodes) n.stage = layerNames[n.col];

  let uMax = 1, vMax = 1;
  for (const n of nodes) {
    uMax = Math.max(uMax, n.u + n.w);
    vMax = Math.max(vMax, n.v + n.d);
  }
  const bounds = { uMin: 0, uMax, vMin: 0, vMax };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const e of rawEdges) {
    const a = nodeById.get(e.from), b = nodeById.get(e.to);
    if (!a || !b) continue;
    edges.push({ from: e.from, to: e.to, weight: e.weight, back: b.col <= a.col, points: routeEdge(a, b, bounds) });
  }
  for (const e of externalPicks) {
    const a = nodeById.get(e.id);
    if (!a) continue;
    for (const cid of e.consumers) {
      const b = nodeById.get(cid);
      if (!b) continue;
      edges.push({ from: e.id, to: cid, weight: 1, back: b.col <= a.col, points: routeEdge(a, b, bounds) });
    }
  }

  return {
    nodes, edges, bounds, kinds: ISO_KINDS, layers: layerNames,
    meta: {
      project: input.projectName,
      analyzedAt: input.analyzedAt,
      gitBranch: input.gitBranch,
      origin: input.origin,
      totalZones: input.zones.length,
      shownZones: selected.length,
      totalFiles: input.totalFiles,
      totalLines: input.totalLines,
      omittedZones: omitted,
      gaps: describeGaps(input),
    },
  };
}

function describeGaps(input) {
  const gaps = [];
  if (input.origin === "scan") {
    gaps.push(
      "Zones were inferred from directory structure, not from community detection. They reflect how the code is filed, which is not always how it is organised.",
    );
    gaps.push(
      "Imports were extracted with regular expressions. Aliased paths, build-tool path mapping and re-export barrels may be missed or misattributed.",
    );
  }
  gaps.push(
    'Edges are static import relationships, not runtime data flow. A drawn edge means "this zone imports that one", not "a request travels this way".',
  );
  gaps.push(
    "Runtime infrastructure — queues, caches, buckets, databases, cron — has no static import signature and is absent unless a zone wraps it in code.",
  );
  gaps.push(
    "Edge direction follows imports. A callback or event seam inverts control at runtime and will appear pointing the wrong way.",
  );
  return gaps;
}

// ── Render ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function embedJSON(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function render(model, titleOverride) {
  const meta = model.meta;
  const title = titleOverride || `${meta.project} — architecture map`;
  const stats = [
    `${meta.shownZones} of ${meta.totalZones} zones`,
    `${fmt(meta.totalFiles)} files`,
    `${fmt(meta.totalLines)} lines`,
    meta.origin === "sourcevision" ? "sourcevision analysis" : "direct scan",
  ];
  if (meta.gitBranch) stats.push(esc(meta.gitBranch));

  const legend = model.kinds.map((k) =>
    `<button class="lg" type="button" data-kind="${esc(k.id)}" aria-pressed="false">` +
    `<i style="background:${esc(k.color)}"></i>${esc(k.label)}</button>`).join("");

  const gaps = meta.gaps.map((g) => `<li>${esc(g)}</li>`).join("");
  const omitted = meta.omittedZones.length
    ? `<p class="note">${meta.omittedZones.length} smaller zones are not drawn: ${esc(meta.omittedZones.slice(0, 12).join(", "))}${meta.omittedZones.length > 12 ? ", …" : ""}. Raise <code>--max-nodes</code> to include them.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${STYLES}
</style>
</head>
<body>
<header class="top">
  <div class="ttl">
    <h1>${esc(meta.project)}</h1>
    <p>${stats.map((s) => `<span>${s}</span>`).join("")}</p>
  </div>
  <div class="tools">
    <button type="button" id="zout" aria-label="Zoom out">&minus;</button>
    <button type="button" id="zin" aria-label="Zoom in">+</button>
    <button type="button" id="fit">Reset view</button>
  </div>
</header>
<main class="wrap">
  <section class="stage" id="stage" aria-label="Isometric architecture map">
    <svg id="iso" role="img" aria-label="Isometric map of ${esc(meta.project)} architecture zones"></svg>
    <div class="legend" role="group" aria-label="Filter by kind">${legend}</div>
  </section>
  <aside class="dossier" id="dossier" aria-live="polite" tabindex="0"></aside>
</main>
<footer class="foot">
  <h2>What this map does and does not show</h2>
  <ul>${gaps}</ul>
  ${omitted}
  <p class="note">Generated ${esc(meta.analyzedAt)}.</p>
</footer>
<script>
(function(){
"use strict";
var MODEL = ${embedJSON(model)};
${RUNTIME}
})();
</script>
</body>
</html>
`;
}

const STYLES = `
:root{--bg:#12122B;--panel:#1A1940;--line:#2C2B60;--ink:#EFEFF7;--muted:#9B9BC4;--accent:#7FAE33;--warn:#E0A33E;--crit:#E36262}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
h1,h2,h3,h4{margin:0;font-weight:650;letter-spacing:-0.01em}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:.85rem 1.15rem;border-bottom:1px solid var(--line);background:var(--panel)}
.ttl h1{font-size:1.12rem}
.ttl p{margin:.2rem 0 0;color:var(--muted);font-size:.82rem;display:flex;gap:.5rem;flex-wrap:wrap}
.ttl p span:not(:last-child)::after{content:" ·";color:var(--line)}
.tools{display:flex;gap:.4rem}
.tools button,.lg{background:#232253;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:.4rem .7rem;font:inherit;font-size:.82rem;cursor:pointer}
.tools button:hover,.lg:hover{background:#2C2B66}
.tools button:focus-visible,.lg:focus-visible,.node:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.wrap{display:grid;grid-template-columns:minmax(0,1fr) 360px;min-height:calc(100vh - 60px)}
@media (max-width:1020px){.wrap{grid-template-columns:1fr}}
.stage{position:relative;overflow:hidden;cursor:grab;touch-action:none}
.stage.dragging{cursor:grabbing}
.stage svg{display:block;width:100%;height:100%;min-height:60vh}
.node,.edge{cursor:pointer}
.node polygon{transition:opacity .12s ease}
.edge polyline{transition:opacity .12s ease}
.edge:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.legend{position:absolute;left:.9rem;bottom:.9rem;display:flex;flex-wrap:wrap;gap:.35rem;max-width:calc(100% - 1.8rem)}
.lg{display:inline-flex;align-items:center;gap:.4rem;background:rgba(26,25,64,.9)}
.lg i{width:11px;height:11px;border-radius:2px;display:block}
.lg[aria-pressed="true"]{border-color:var(--accent);background:#2E3A20}
.dossier{border-left:1px solid var(--line);background:var(--panel);padding:1.1rem 1.15rem;overflow-y:auto;max-height:calc(100vh - 60px)}
@media (max-width:1020px){.dossier{border-left:0;border-top:1px solid var(--line);max-height:none}}
.dossier h3{font-size:1.05rem;margin:.15rem 0 .1rem}
.dossier h4{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:1.1rem 0 .35rem}
.dossier .sub{color:var(--muted);font-size:.84rem}
.dossier .body{margin:.6rem 0 0;font-size:.9rem;color:#D3D3E8}
.dossier ul{margin:.3rem 0 0;padding-left:1.05rem;font-size:.86rem;color:#D3D3E8}
.dossier li{margin:.22rem 0}
.dossier ul.files{list-style:none;padding-left:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.78rem}
.dossier ul.files li{overflow-wrap:anywhere;color:var(--muted)}
.kind{display:inline-flex;align-items:center;gap:.4rem;font-size:.75rem;color:var(--muted)}
.kind i{width:10px;height:10px;border-radius:2px;display:block}
.mx{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.7rem}
.mx span{background:#232253;border:1px solid var(--line);border-radius:5px;padding:.2rem .45rem;font-size:.75rem;color:var(--muted)}
.mx b{color:var(--ink);font-weight:600}
.risk-at-risk{color:var(--warn)}
.risk-critical,.risk-catastrophic{color:var(--crit)}
.sev-warning{color:var(--warn)}
.sev-critical{color:var(--crit)}
.link{background:none;border:0;padding:0;color:var(--accent);font:inherit;font-size:.86rem;cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:2px}
.foot{border-top:1px solid var(--line);padding:1.1rem 1.15rem 2rem;background:var(--panel)}
.foot h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.foot ul{margin:.5rem 0 0;padding-left:1.05rem;max-width:75ch;font-size:.86rem;color:#D3D3E8}
.foot li{margin:.3rem 0}
.note{color:var(--muted);font-size:.8rem;max-width:75ch;margin:.8rem 0 0}
`;

const RUNTIME = `
var NS="http://www.w3.org/2000/svg";
var CELL=19,CX=0.866,CY=0.5,CZ=0.62;
var NODES=MODEL.nodes,EDGES=MODEL.edges,B=MODEL.bounds;
var COLOR={},LABEL={};
MODEL.kinds.forEach(function(k){COLOR[k.id]=k.color;LABEL[k.id]=k.label;});
var BY={};NODES.forEach(function(n){BY[n.id]=n;});

function P(u,v,z){return [(u-v)*CX*CELL,((u+v)*CY-(z||0)*CZ)*CELL];}
function pts(a){return a.map(function(p){return p[0].toFixed(1)+","+p[1].toFixed(1);}).join(" ");}
function el(t,attrs){var e=document.createElementNS(NS,t);for(var k in attrs)if(Object.prototype.hasOwnProperty.call(attrs,k))e.setAttribute(k,attrs[k]);return e;}
function shade(hex,amt){var n=parseInt(hex.slice(1),16),r=n>>16,g=(n>>8)&255,b=n&255;
function f(c){c=Math.round(amt<0?c*(1+amt):c+(255-c)*amt);return Math.max(0,Math.min(255,c));}
return "#"+((1<<24)+(f(r)<<16)+(f(g)<<8)+f(b)).toString(16).slice(1);}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function num(n){return Number(n).toLocaleString("en-US");}

var svg=document.getElementById("iso");
var defs=el("defs");
["#4A4990","#7FAE33"].forEach(function(col,i){
  var m=el("marker",{id:"arw"+i,viewBox:"0 0 10 10",refX:"8",refY:"5",markerWidth:"5",markerHeight:"5",orient:"auto-start-reverse"});
  m.appendChild(el("path",{d:"M0,1 L9,5 L0,9 z",fill:col}));defs.appendChild(m);});
svg.appendChild(defs);
var camera=el("g",{id:"camera"});svg.appendChild(camera);
var gGround=el("g"),gEdge=el("g"),gBlock=el("g"),gTag=el("g");
camera.appendChild(gGround);camera.appendChild(gEdge);camera.appendChild(gBlock);camera.appendChild(gTag);

var uMin=B.uMin-3,uMax=B.uMax+3,vMin=B.vMin-3,vMax=B.vMax+5;
gGround.appendChild(el("polygon",{points:pts([P(uMin,vMin,0),P(uMax,vMin,0),P(uMax,vMax,0),P(uMin,vMax,0)]),fill:"#171639",stroke:"#2C2B60","stroke-width":"1"}));
for(var gu=uMin;gu<=uMax;gu+=4)gGround.appendChild(el("line",{x1:P(gu,vMin,0)[0],y1:P(gu,vMin,0)[1],x2:P(gu,vMax,0)[0],y2:P(gu,vMax,0)[1],stroke:"#222150","stroke-width":"1"}));
for(var gv=vMin;gv<=vMax;gv+=3)gGround.appendChild(el("line",{x1:P(uMin,gv,0)[0],y1:P(uMin,gv,0)[1],x2:P(uMax,gv,0)[0],y2:P(uMax,gv,0)[1],stroke:"#222150","stroke-width":"1"}));

// Each edge gets a fat transparent hit line under the visible one: a 2-4px
// stroke is close to unclickable, and the connectors carry real information.
var edgeEls=[];
EDGES.forEach(function(e,index){
  var proj=e.points.map(function(q){return P(q[0],q[1],0);});
  var from=BY[e.from],to=BY[e.to];
  var g=el("g",{"class":"edge",tabindex:"0",role:"button",
    "aria-label":"Dependency: "+(from?from.name:e.from)+" imports "+(to?to.name:e.to)+", "+e.weight+" references"});
  var hit=el("polyline",{points:pts(proj),fill:"none",stroke:"transparent","stroke-width":"14","stroke-linejoin":"round","stroke-linecap":"round"});
  var line=el("polyline",{points:pts(proj),fill:"none",stroke:"#4A4990",
    "stroke-width":Math.min(4.5,1.6+Math.log(e.weight+1)),"stroke-linejoin":"round","stroke-linecap":"round","marker-end":"url(#arw0)"});
  if(e.back)line.setAttribute("stroke-dasharray","7 6");
  g.appendChild(hit);g.appendChild(line);gEdge.appendChild(g);
  edgeEls.push({e:e,g:g,node:line});
  g.addEventListener("click",function(ev){if(dragMoved)return;ev.stopPropagation();lastPick=Date.now();selectEdge(index);});
  g.addEventListener("keydown",function(ev){if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();selectEdge(index);}});
});

var order=NODES.slice().sort(function(x,y){return (x.u+x.v)-(y.u+y.v);});
var blockEls={};
order.forEach(function(n){
  var base=COLOR[n.kind]||"#6F7BA6";
  var g=el("g",{"class":"node",tabindex:"0",role:"button","aria-label":n.name+", "+(LABEL[n.kind]||n.kind)+", "+n.sub});
  var u=n.u,v=n.v,w=n.w,d=n.d,h=n.h;
  var faceL=el("polygon",{points:pts([P(u,v+d,h),P(u+w,v+d,h),P(u+w,v+d,0),P(u,v+d,0)]),fill:shade(base,-0.42)});
  var faceR=el("polygon",{points:pts([P(u+w,v,h),P(u+w,v+d,h),P(u+w,v+d,0),P(u+w,v,0)]),fill:shade(base,-0.24)});
  var top=el("polygon",{points:pts([P(u,v,h),P(u+w,v,h),P(u+w,v+d,h),P(u,v+d,h)]),fill:base,stroke:shade(base,0.28),"stroke-width":"1"});
  g.appendChild(faceL);g.appendChild(faceR);g.appendChild(top);gBlock.appendChild(g);
  var cTop=P(u+w/2,v+d/2,h);
  var tagY=cTop[1]-28,tagX=cTop[0];
  var label=n.name.toUpperCase();
  var tw=Math.max(70,label.length*8.4+26),th=22;
  var tg=el("g",{"class":"node",tabindex:"-1","aria-hidden":"true"});
  tg.appendChild(el("line",{x1:tagX,y1:tagY+th/2,x2:cTop[0],y2:cTop[1],stroke:shade(base,0.1),"stroke-width":"1.3","stroke-dasharray":"3 3"}));
  var rect=el("rect",{x:tagX-tw/2,y:tagY-th/2,width:tw,height:th,rx:"3",fill:"#1B1A45",stroke:base,"stroke-width":"1.5"});
  tg.appendChild(rect);
  tg.appendChild(el("rect",{x:tagX-tw/2+6,y:tagY-4,width:8,height:8,rx:"2",fill:base}));
  var t=el("text",{x:tagX+7,y:tagY,"text-anchor":"middle","dominant-baseline":"central",fill:"#EFEFF7","font-family":"ui-sans-serif,system-ui,sans-serif","font-size":"11","font-weight":"600","letter-spacing":"0.04em"});
  t.textContent=label;tg.appendChild(t);gTag.appendChild(tg);
  blockEls[n.id]={g:g,tag:tg,rect:rect,text:t,top:top,base:base};
  // Only "click" - listening on pointerup as well fires pick twice per press.
  function pick(ev){if(dragMoved)return;ev.stopPropagation();lastPick=Date.now();selectNode(n.id);}
  g.addEventListener("click",pick);
  tg.addEventListener("click",pick);
  g.addEventListener("keydown",function(ev){if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();selectNode(n.id);}});
});

var xs=[],ys=[];
[[uMin,vMin],[uMax,vMin],[uMax,vMax],[uMin,vMax]].forEach(function(q){var p=P(q[0],q[1],0);xs.push(p[0]);ys.push(p[1]);});
NODES.forEach(function(n){var p=P(n.u+n.w/2,n.v+n.d/2,n.h);ys.push(p[1]-46);});
var minX=Math.min.apply(null,xs)-20,maxX=Math.max.apply(null,xs)+20;
var minY=Math.min.apply(null,ys)-14,maxY=Math.max.apply(null,ys)+20;
svg.setAttribute("viewBox",minX+" "+minY+" "+(maxX-minX)+" "+(maxY-minY));
svg.setAttribute("preserveAspectRatio","xMidYMid meet");

var dossier=document.getElementById("dossier");
var INTRO='<h3>'+esc(MODEL.meta.project)+'</h3>'+
  '<div class="sub">'+num(MODEL.meta.shownZones)+' zones &middot; '+
  (MODEL.meta.origin==="sourcevision"?'from sourcevision analysis':'from a direct scan')+'</div>'+
  '<div class="body">Each block is a zone of the codebase. Footprint scales with file count and height '+
  'with line count, so the tall wide blocks are where the code actually is. Colour is what the zone '+
  'mostly does. Solid lines are import dependencies pointing from the importer to what it imports; '+
  'dashed lines run backwards through the layering and mark a dependency cycle.</div>'+
  '<h4>Try this</h4><ul>'+
  '<li>Click a block to see its files and cross-zone edges.</li>'+
  '<li>Click a connector to see what the dependency is made of.</li>'+
  '<li>Use the legend to isolate one kind of zone.</li>'+
  '<li>Drag to pan, scroll to zoom, <b>Reset view</b> to recentre. <b>Esc</b> clears.</li></ul>';

function linkList(items){
  if(!items.length)return '<p class="sub">None.</p>';
  return '<ul>'+items.map(function(l){
    return '<li><button type="button" class="link" data-goto="'+esc(l.id)+'">'+esc(l.name)+
      '</button> <span class="sub">&times;'+num(l.weight)+'</span></li>';}).join("")+'</ul>';
}

function renderNode(n){
  var color=COLOR[n.kind]||"#6F7BA6";
  var h='<div class="kind"><i style="background:'+esc(color)+'"></i>'+esc(n.stage)+' &middot; '+esc(LABEL[n.kind]||n.kind)+'</div>';
  h+='<h3>'+esc(n.name)+'</h3><div class="sub">'+esc(n.sub)+'</div>';
  if(n.kind!=="external"){
    h+='<div class="mx"><span>cohesion <b>'+n.metrics.cohesion.toFixed(2)+'</b></span>'+
       '<span>coupling <b>'+n.metrics.coupling.toFixed(2)+'</b></span>'+
       (n.metrics.riskLevel!=="unscored"?'<span class="risk-'+esc(n.metrics.riskLevel)+'">risk <b>'+esc(n.metrics.riskLevel)+'</b></span>':'')+
       '</div>';
  }
  if(n.body)h+='<div class="body">'+esc(n.body)+'</div>';
  if(n.mix.length){h+='<h4>Contents</h4><div class="mx">'+n.mix.map(function(a){
    return '<span>'+esc(LABEL[a[0]]||a[0])+' <b>'+num(a[1])+'</b></span>';}).join("")+'</div>';}
  if(n.insights.length){h+='<h4>Insights</h4><ul>'+n.insights.map(function(i){return '<li>'+esc(i)+'</li>';}).join("")+'</ul>';}
  if(n.findings.length){h+='<h4>Findings</h4><ul>'+n.findings.map(function(f){
    return '<li class="sev-'+esc(f.severity)+'">'+esc(f.text)+'</li>';}).join("")+'</ul>';}
  if(n.keyFiles.length){h+='<h4>Key files</h4><ul class="files">'+n.keyFiles.map(function(f){return '<li>'+esc(f)+'</li>';}).join("")+'</ul>';}
  h+='<h4>Imported by</h4>'+linkList(n.inbound);
  h+='<h4>Imports</h4>'+linkList(n.outbound);
  return h;
}

function renderEdge(e){
  var from=BY[e.from],to=BY[e.to];
  var fromName=from?from.name:e.from,toName=to?to.name:e.to;
  var h='<div class="kind">Dependency</div>';
  h+='<h3>'+esc(fromName)+' &rarr; '+esc(toName)+'</h3>';
  h+='<div class="sub">'+num(e.weight)+' cross-zone import '+(e.weight===1?'reference':'references')+'</div>';
  h+='<div class="body">'+esc(fromName)+' imports from '+esc(toName)+'. '+
    (e.back?'This edge runs backwards through the layering, so these two zones sit in a dependency cycle &mdash; the arrow is drawn through the return lane below the scene.'
           :'The arrow points from the importer to what it imports.')+'</div>';
  h+='<h4>Both ends</h4><ul>'+
    '<li><button type="button" class="link" data-goto="'+esc(e.from)+'">'+esc(fromName)+'</button>'+
    (from?' <span class="sub">'+esc(from.sub)+'</span>':'')+'</li>'+
    '<li><button type="button" class="link" data-goto="'+esc(e.to)+'">'+esc(toName)+'</button>'+
    (to?' <span class="sub">'+esc(to.sub)+'</span>':'')+'</li></ul>';
  return h;
}

function bindLinks(){
  var links=dossier.querySelectorAll("[data-goto]");
  for(var i=0;i<links.length;i++)links[i].addEventListener("click",function(ev){selectNode(ev.currentTarget.getAttribute("data-goto"));});
}

var curNode=null,curEdge=null,activeKinds={};
function kindVisible(kind){var any=false;for(var k in activeKinds)if(activeKinds[k]){any=true;break;}return !any||!!activeKinds[kind];}
function highlighted(){
  var s={};
  if(curNode){s[curNode]=true;EDGES.forEach(function(e){if(e.from===curNode)s[e.to]=true;if(e.to===curNode)s[e.from]=true;});}
  else if(curEdge!==null){var e=EDGES[curEdge];s[e.from]=true;s[e.to]=true;}
  return s;
}

function refresh(scrollPanel){
  var focused=(curNode!==null||curEdge!==null);
  var near=highlighted();
  NODES.forEach(function(n){
    var b=blockEls[n.id],shown=kindVisible(n.kind),on=(n.id===curNode),linked=focused?!!near[n.id]:true;
    b.g.setAttribute("opacity",String(!shown?0.08:(on?1:(linked?0.85:0.28))));
    b.tag.setAttribute("opacity",String(!shown?0.05:(on?1:(linked?0.8:0.22))));
    b.rect.setAttribute("fill",on?b.base:"#1B1A45");
    b.text.setAttribute("fill",on?"#12122B":"#EFEFF7");
    b.top.setAttribute("stroke",on?"#FFFFFF":shade(b.base,0.28));
    b.top.setAttribute("stroke-width",on?"2.4":"1");
    b.g.setAttribute("tabindex",shown?"0":"-1");
  });
  edgeEls.forEach(function(x,i){
    var hot=(i===curEdge)||(curNode!==null&&(x.e.from===curNode||x.e.to===curNode));
    var ends=kindVisible((BY[x.e.from]||{}).kind)&&kindVisible((BY[x.e.to]||{}).kind);
    x.node.setAttribute("stroke",hot?"#7FAE33":"#4A4990");
    x.node.setAttribute("marker-end",hot?"url(#arw1)":"url(#arw0)");
    x.node.setAttribute("opacity",!ends?"0.05":(focused?(hot?"1":"0.18"):"0.85"));
    x.g.setAttribute("tabindex",ends?"0":"-1");
  });
  if(curNode!==null&&BY[curNode])dossier.innerHTML=renderNode(BY[curNode]);
  else if(curEdge!==null)dossier.innerHTML=renderEdge(EDGES[curEdge]);
  else dossier.innerHTML=INTRO;
  bindLinks();
  dossier.scrollTop=0;
  // On a narrow layout the panel sits below the map, so a selection would
  // otherwise update off-screen and read as "clicking does nothing".
  if(scrollPanel&&window.innerWidth<=1020&&dossier.scrollIntoView){
    try{dossier.scrollIntoView({behavior:"smooth",block:"nearest"});}catch(err){}
  }
}

function selectNode(id){if(!BY[id])return;curNode=id;curEdge=null;refresh(true);}
function selectEdge(index){if(!EDGES[index])return;curEdge=index;curNode=null;refresh(true);}
function clearSelection(){if(curNode===null&&curEdge===null)return;curNode=null;curEdge=null;refresh(false);}

var legendButtons=document.querySelectorAll(".lg");
for(var li=0;li<legendButtons.length;li++){
  legendButtons[li].addEventListener("click",function(ev){
    var btn=ev.currentTarget,kind=btn.getAttribute("data-kind");
    activeKinds[kind]=!activeKinds[kind];
    btn.setAttribute("aria-pressed",activeKinds[kind]?"true":"false");
    refresh(false);});
}

var k=1,tx=0,ty=0,dragging=false,dragMoved=false,sx=0,sy=0,stx=0,sty=0,lastPick=0;
var stage=document.getElementById("stage");
function apply(){camera.setAttribute("transform","translate("+tx+" "+ty+") scale("+k+")");}
function toVB(ev){
  if(!svg.createSVGPoint)return{x:ev.clientX,y:ev.clientY};
  var pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;
  var m=svg.getScreenCTM();if(!m)return{x:0,y:0};var p=pt.matrixTransform(m.inverse());return{x:p.x,y:p.y};}
stage.addEventListener("wheel",function(ev){ev.preventDefault();
  var p=toVB(ev),wx=(p.x-tx)/k,wy=(p.y-ty)/k;
  var nk=Math.max(0.4,Math.min(5,k*Math.exp(-ev.deltaY*0.0016)));
  tx=p.x-wx*nk;ty=p.y-wy*nk;k=nk;apply();},{passive:false});
stage.addEventListener("pointerdown",function(ev){
  if(ev.button!==undefined&&ev.button!==0)return;
  dragging=true;dragMoved=false;var p=toVB(ev);sx=p.x;sy=p.y;stx=tx;sty=ty;});
window.addEventListener("pointermove",function(ev){
  if(!dragging)return;var p=toVB(ev),dx=p.x-sx,dy=p.y-sy;
  if(!dragMoved){if(Math.abs(dx)*k<6&&Math.abs(dy)*k<6)return;dragMoved=true;stage.classList.add("dragging");}
  tx=stx+dx;ty=sty+dy;apply();});
window.addEventListener("pointerup",function(){dragging=false;stage.classList.remove("dragging");});
window.addEventListener("pointercancel",function(){dragging=false;dragMoved=false;stage.classList.remove("dragging");});
stage.addEventListener("click",function(){if(dragMoved)return;if(Date.now()-lastPick<350)return;clearSelection();});
function zoomBy(f){var cx=minX+(maxX-minX)/2,cy=minY+(maxY-minY)/2;
  var wx=(cx-tx)/k,wy=(cy-ty)/k,nk=Math.max(0.4,Math.min(5,k*f));
  tx=cx-wx*nk;ty=cy-wy*nk;k=nk;apply();}
document.getElementById("zin").addEventListener("click",function(){zoomBy(1.28);});
document.getElementById("zout").addEventListener("click",function(){zoomBy(1/1.28);});
document.getElementById("fit").addEventListener("click",function(){k=1;tx=0;ty=0;apply();});
document.addEventListener("keydown",function(ev){if(ev.key==="Escape")clearSelection();});
apply();refresh(false);
`;

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  const root = resolve(opts.dir);
  if (!existsSync(root)) fail(`Directory not found: ${root}`);

  let input = null;
  if (opts.source !== "scan") {
    input = loadSourcevision(root);
    if (!input && opts.source === "sourcevision") {
      fail(`No usable .sourcevision/ output in ${root}. Run 'sourcevision analyze', or use --source=scan.`);
    }
  }
  if (!input) input = scanProject(root);

  if (input.zones.length === 0) fail("No zones could be derived — nothing to draw.");

  const model = buildModel(input, opts);
  const out = resolve(opts.out || join(root, "iso-map.html"));
  if (!existsSync(dirname(out))) fail(`Output directory does not exist: ${dirname(out)}`);

  writeFileSync(out, render(model, opts.title), "utf-8");

  if (opts.json) process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
  process.stderr.write(
    `iso-map: wrote ${out} — ${model.meta.shownZones} zones, ${model.edges.length} edges (${input.origin})\n`,
  );
}

main();
