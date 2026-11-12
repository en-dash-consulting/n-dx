/**
 * At-a-glance impact of a PRD item, for readers who do not read code: how many
 * files it touches and what kind, whether any of them hold secrets or keys,
 * and whether it reaches the parts much of the project depends on.
 *
 * Two sources, best first:
 *  - **actual** — the files hench runs on the item (or its descendants)
 *    changed, from each run file's `structuredSummary.filesChanged`;
 *  - **expected** — file paths the item's own text names (title, description,
 *    intent, acceptance criteria), for work not run yet.
 *
 * "Essential" files are the ones many others import (sourcevision's import
 * graph) and the root manifests, lockfiles and CI workflows every build reads.
 * Everything here is a heuristic, and the tags say which source they came from.
 *
 * Pure apart from {@link RunFilesCache} and {@link importFanIn}, which read
 * disk; the route lives in `routes-rex/impact.ts`.
 *
 * @module web/server/item-impact
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type FileKind = "code" | "test" | "config" | "docs" | "other";
export type ImpactSize = "small" | "medium" | "large";

/** One item's impact, as `GET /api/rex/impact` serves it. Mirrored in viewer/components/impact-tags.ts. */
export interface ItemImpact {
  /** Where the file list came from. */
  basis: "actual" | "expected";
  /** Every file counted (repo-relative, or as the item names it), capped at {@link MAX_FILES_LISTED}. */
  files: string[];
  fileCount: number;
  /** Null when no file is known. */
  size: ImpactSize | null;
  kinds: Partial<Record<FileKind, number>>;
  /** Why the item is flagged security-sensitive: file paths, or the words in its text. Empty when it is not. */
  security: string[];
  /** Files most of the project depends on. Empty when none. */
  essential: string[];
}

/** The item fields this module reads; a PRDItem satisfies it. */
export interface ImpactSourceItem {
  id: string;
  title: string;
  description?: string;
  intent?: string;
  acceptanceCriteria?: string[];
  children?: ImpactSourceItem[];
}

export const MAX_FILES_LISTED = 50;
/** Upper bounds of small and medium, in files. */
export const SIZE_BOUNDS = { small: 3, medium: 10 } as const;
/** Importers a file needs before it counts as essential. */
export const ESSENTIAL_FAN_IN = 15;

const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|swift|rb|php|cs|c|cc|cpp|h|hpp|scala|sh|ps1|sql|vue|svelte|css|scss|html)$/i;
const CONFIG_EXT = /\.(?:json|jsonc|ya?ml|toml|ini|env|lock|xml|gradle|properties|conf|cfg)$/i;
const DOCS_EXT = /\.(?:md|mdx|txt|rst|adoc)$/i;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|e2e|fixtures)\/|\.(?:test|spec)\.[^/]+$/i;
const CONFIG_NAME = /(?:^|\/)(?:\.env(?:\.[\w.-]+)?|Dockerfile|Makefile|\.gitignore|\.npmrc|\.nvmrc|[\w.-]*rc)$/;

/** What kind of file a path is: tests first, since a test file is code too. */
export function fileKind(path: string): FileKind {
  if (TEST_PATH.test(path)) return "test";
  if (DOCS_EXT.test(path) || /(?:^|\/)docs\//i.test(path)) return "docs";
  if (CONFIG_EXT.test(path) || CONFIG_NAME.test(path)) return "config";
  if (CODE_EXT.test(path)) return "code";
  return "other";
}

/**
 * A path that holds or handles secrets: env files, key and certificate files,
 * and names that say secret, credential, password, API key, private key,
 * keychain/keystore or auth. Plain "token" is left out: in most repos it means
 * LLM token counts far more often than a credential.
 */
const SECURITY_PATH = /(?:^|\/)\.env(?:\.|$)|secret|credential|passw(?:or)?d|api[-_]?key|private[-_]?key|id_rsa|keychain|keystore|\.(?:pem|key|p12|pfx|crt|cer|jks)$|(?:^|[/._-])auth(?:[/._-]|$)|auth[-_.]?token/i;

const SECRET_NOUN = String.raw`(?:secrets?|credentials?|passwords?|api[- ]keys?|private keys?|signing keys?|encryption keys?|access tokens?|auth tokens?|certificates?)`;

/** A title that names a secret is about one. */
const SECURITY_TITLE = new RegExp(String.raw`\b(?:key rotation|${SECRET_NOUN})\b`, "gi");

/**
 * Body text has to act on one: rotate, revoke, leak, expose, encrypt or
 * hard-code a secret, key or token. A description that merely mentions
 * credentials (or a feature that flags them) is not flagged, and neither is
 * a token that is a count: "expose token usage", "leak token totals".
 */
const SECURITY_ACTION = new RegExp(
  String.raw`\b(?:key rotation|(?:rotat|revok|leak|expos|encrypt|hard-?cod)\w*\s+(?:[\w-]+\s+){0,3}?(?:${SECRET_NOUN}|keys?|tokens?))\b(?![\s-]+(?:usage|counts?|budgets?|totals?|spend|costs?|limits?|estimates?|per)\b)`,
  "gi",
);

export function isSecurityPath(path: string): boolean {
  return SECURITY_PATH.test(path);
}

/** Distinct security phrases in an item's titles and body, lower-cased, in first-seen order. */
export function securityTerms(title: string, body = ""): string[] {
  const seen = new Set<string>();
  const add = (text: string, re: RegExp) => {
    for (const m of text.matchAll(re)) seen.add(m[0].toLowerCase().replace(/\s+/g, " "));
  };
  add(title, SECURITY_TITLE);
  add(body, SECURITY_ACTION);
  return [...seen];
}

/** Root files every build or install reads, whatever imports them. */
const ROOT_ESSENTIAL = /^(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|pnpm-workspace\.yaml|tsconfig(?:\.[\w-]+)?\.json|Dockerfile|\.github\/workflows\/[^/]+)$/;

/**
 * Path-like tokens in free text: anything with a slash and an extension
 * (`packages/web/src/x.ts`), or a bare file name with a known extension
 * (`ready-to-run.ts`, `.n-dx.json`). URLs are skipped.
 */
/** Product names that read as a file name: "Node.js", "Vue.js". */
const NOT_A_FILE = /^(?:node|next|nuxt|vue|react|express|deno|bun|d3|three|chart|ember|backbone|angular|svelte|solid|alpine)\.js$/i;

export function mentionedPaths(text: string): string[] {
  const out = new Set<string>();
  const withoutUrls = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
  const token = /(?:^|[\s`'"(\[<])((?:[\w.@-]+\/)*[\w.@-]*\.[A-Za-z][\w]{0,9})(?=$|[\s`'"),:;\]>]|\.(?:\s|$))/g;
  for (const m of withoutUrls.matchAll(token)) {
    const candidate = m[1]!.replace(/^\.\//, "");
    // A bare word with a dot (e.g. "e.g", "v1.2") is not a file unless its extension is one we classify.
    if (fileKind(candidate) === "other") continue;
    if (/^\d/.test(candidate) && !candidate.includes("/")) continue;
    if (NOT_A_FILE.test(candidate)) continue;
    out.add(candidate);
  }
  return [...out];
}

export function impactSize(fileCount: number): ImpactSize | null {
  if (fileCount <= 0) return null;
  if (fileCount <= SIZE_BOUNDS.small) return "small";
  if (fileCount <= SIZE_BOUNDS.medium) return "medium";
  return "large";
}

/**
 * The graph's essential files, indexed by base name so a partial path from an
 * item's text (`views/stages.ts`, `index.ts`) resolves without a scan.
 */
export class EssentialIndex {
  private readonly byBase = new Map<string, Array<[string, number]>>();

  constructor(private readonly fanIn: ReadonlyMap<string, number>) {
    for (const [path, n] of fanIn) {
      const base = path.slice(path.lastIndexOf("/") + 1);
      const list = this.byBase.get(base) ?? [];
      list.push([path, n]);
      this.byBase.set(base, list);
    }
  }

  /**
   * Root manifests, lockfiles and CI workflows always; otherwise a file with
   * at least {@link ESSENTIAL_FAN_IN} importers. A partial path counts only
   * when exactly one graph file ends with it: `index.ts` names dozens of
   * files, most of them leaves.
   */
  has(file: string): boolean {
    if (ROOT_ESSENTIAL.test(file)) return true;
    const direct = this.fanIn.get(file);
    if (direct !== undefined) return direct >= ESSENTIAL_FAN_IN;
    const base = file.slice(file.lastIndexOf("/") + 1);
    const matches = (this.byBase.get(base) ?? []).filter(([path]) => path.endsWith(`/${file}`));
    return matches.length === 1 && matches[0]![1] >= ESSENTIAL_FAN_IN;
  }
}

/** The impact of one set of files plus the item's titles and body text. */
export function describeImpact(
  basis: ItemImpact["basis"],
  files: readonly string[],
  text: { title: string; body: string },
  essential: EssentialIndex,
): ItemImpact {
  const unique = [...new Set(files)].sort();
  const kinds: Partial<Record<FileKind, number>> = {};
  for (const f of unique) {
    const k = fileKind(f);
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  const securityFiles = unique.filter(isSecurityPath);
  return {
    basis,
    files: unique.slice(0, MAX_FILES_LISTED),
    fileCount: unique.length,
    size: impactSize(unique.length),
    kinds,
    security: [...securityFiles, ...securityTerms(text.title, text.body)],
    essential: unique.filter((f) => essential.has(f)),
  };
}

function ownBody(item: ImpactSourceItem): string {
  return [item.description ?? "", item.intent ?? "", ...(item.acceptanceCriteria ?? [])].join("\n");
}

interface Gathered { title: string; body: string; mentioned: Set<string>; ran: Set<string> }

/**
 * Every item's impact, keyed by id. An item's files are its own plus its
 * descendants'; runs on any of them make the basis actual. An item with no
 * file and no security term is left out.
 */
export function computeImpacts(
  items: readonly ImpactSourceItem[],
  runFilesByTask: ReadonlyMap<string, readonly string[]>,
  fanIn: ReadonlyMap<string, number>,
): Record<string, ItemImpact> {
  const out: Record<string, ItemImpact> = {};
  const essential = new EssentialIndex(fanIn);
  const visit = (item: ImpactSourceItem): Gathered => {
    const titles = [item.title];
    const bodies = [ownBody(item)];
    const mentioned = new Set(mentionedPaths(`${item.title}\n${bodies[0]}`));
    const ran = new Set(runFilesByTask.get(item.id) ?? []);
    for (const child of item.children ?? []) {
      const sub = visit(child);
      titles.push(sub.title);
      bodies.push(sub.body);
      for (const f of sub.mentioned) mentioned.add(f);
      for (const f of sub.ran) ran.add(f);
    }
    const text = { title: titles.join("\n"), body: bodies.join("\n") };
    const impact = ran.size > 0
      ? describeImpact("actual", [...ran], text, essential)
      : describeImpact("expected", [...mentioned], text, essential);
    if (impact.fileCount > 0 || impact.security.length > 0) out[item.id] = impact;
    return { ...text, mentioned, ran };
  };
  for (const item of items) visit(item);
  return out;
}

/**
 * Distinct importers per imported file, from sourcevision's `imports.json`
 * edges. Test files are not counted as importers: a module many tests import
 * is well tested, not one much of the product depends on.
 */
export function importFanIn(svDir: string): Map<string, number> {
  const path = join(svDir, "imports.json");
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    // No analysis yet: nothing counts as essential by fan-in.
  }
  const cached = fanInCache.get(svDir);
  if (cached && cached.mtimeMs === mtimeMs) return cached.fanIn;
  const fanIn = readFanIn(path);
  fanInCache.set(svDir, { mtimeMs, fanIn });
  return fanIn;
}

/** The last fan-in per sourcevision dir, kept until its `imports.json` changes. */
const fanInCache = new Map<string, { mtimeMs: number; fanIn: Map<string, number> }>();

function readFanIn(path: string): Map<string, number> {
  const importers = new Map<string, Set<string>>();
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { edges?: Array<{ from?: unknown; to?: unknown }> };
    for (const e of data.edges ?? []) {
      if (typeof e.from !== "string" || typeof e.to !== "string" || fileKind(e.from) === "test") continue;
      let set = importers.get(e.to);
      if (!set) importers.set(e.to, (set = new Set()));
      set.add(e.from);
    }
  } catch {
    // No analysis yet: nothing counts as essential by fan-in.
  }
  return new Map([...importers].map(([to, from]) => [to, from.size]));
}

interface CachedRun { mtimeMs: number; taskId: string | null; files: string[] }

/** Tool state a run writes beside the work: never part of the item's size. */
const TOOL_STATE = /^\.(?:git|rex|ndx|hench|sourcevision)(?:\/|$)/i;

/**
 * A run's `filesChanged` entry as a project-relative, forward-slash path, or
 * null for tool state and for an absolute path outside `projectDir`. Older
 * runs list a file twice, once absolute with backslashes, so both forms must
 * land on the same path.
 */
export function runFilePath(raw: string, projectDir?: string): string | null {
  let path = raw.trim().replace(/\\/g, "/");
  if (/^(?:[A-Za-z]:)?\//.test(path)) {
    const root = projectDir ? `${projectDir.replace(/\\/g, "/").replace(/\/+$/, "")}/` : null;
    if (!root || !path.toLowerCase().startsWith(root.toLowerCase())) return null;
    path = path.slice(root.length);
  }
  path = path.replace(/^(?:\.\/)+/, "");
  if (!path || TOOL_STATE.test(path)) return null;
  return path;
}

/**
 * `filesChanged` per task across a runs directory. Each run file is parsed once
 * and re-read only when its mtime moves, so a repeat request costs one stat per
 * file.
 */
export class RunFilesCache {
  private readonly runs = new Map<string, CachedRun>();

  constructor(private readonly runsDir: string, private readonly projectDir?: string) {}

  byTask(): Map<string, string[]> {
    let names: string[];
    try {
      names = readdirSync(this.runsDir).filter((n) => n.endsWith(".json"));
    } catch {
      names = [];
    }
    const live = new Set(names);
    for (const name of [...this.runs.keys()]) if (!live.has(name)) this.runs.delete(name);
    const out = new Map<string, string[]>();
    for (const name of names) {
      const run = this.read(name);
      if (!run?.taskId || run.files.length === 0) continue;
      const list = out.get(run.taskId) ?? [];
      list.push(...run.files);
      out.set(run.taskId, list);
    }
    return out;
  }

  private read(name: string): CachedRun | null {
    const path = join(this.runsDir, name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      return null;
    }
    const cached = this.runs.get(name);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    let entry: CachedRun = { mtimeMs, taskId: null, files: [] };
    try {
      const run = JSON.parse(readFileSync(path, "utf-8")) as { taskId?: unknown; structuredSummary?: { filesChanged?: unknown } };
      const files = run.structuredSummary?.filesChanged;
      entry = {
        mtimeMs,
        taskId: typeof run.taskId === "string" ? run.taskId : null,
        files: Array.isArray(files)
          ? [...new Set(files.flatMap((f) => (typeof f === "string" ? [runFilePath(f, this.projectDir)] : [])).filter((f): f is string => f !== null))]
          : [],
      };
    } catch {
      // A run file mid-write: try again on the next request.
      return null;
    }
    this.runs.set(name, entry);
    return entry;
  }
}
