/**
 * SDLC readiness profile: what this repository can actually do, with proof.
 *
 * Writes `sdlc-profile.json`. Every claim carries the file that supports it,
 * so a scorecard can show its working rather than asserting a number.
 *
 * ## Why its own traversal
 *
 * The inventory deliberately throws away everything this analyzer needs: the
 * `codeOnly` filter in `analyzers/inventory.ts` defaults to true and drops
 * YAML, JSON, TOML, Dockerfiles and `.tf`. Widening it would pollute zone
 * detection — a repository of CI workflows is not a repository about CI — so
 * this walks for itself, as `project-profile.ts` and the IaC discovery already
 * do. `inventory.ts` is untouched; its `IgnoreFilter` is reused, because a
 * second `.gitignore` interpreter would drift from the first.
 *
 * ## Deterministic, and that is the whole point
 *
 * No LLM call, no network access, no clock. Two runs over an unchanged tree
 * produce byte-identical output, on any machine: every ordering goes through
 * the codepoint comparator in `util/sort.ts`, never `localeCompare`, whose
 * answer depends on the ICU locale of the host. An enrichment pass may later
 * refine a genuinely ambiguous judgement ("does this job deploy?"), but the
 * deterministic result has to stand alone and be unchanged without a key.
 *
 * ## Found-but-unreadable is not the same as absent
 *
 * A CI file that will not parse is recorded in `parseFailures` with its path.
 * Reporting it as an empty `ci` array would say "this project has no
 * pipeline", which is the opposite of what was observed.
 *
 * @module sourcevision/analyzers/sdlc-profile
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { loadIgnoreFilter, type IgnoreFilter } from "./inventory.js";
import { discoverFromIaC } from "../export/iso-declared.js";
import { cmp } from "../util/sort.js";
import {
  isMap,
  listAt,
  parseYamlSubset,
  stringAt,
  YamlSubsetError,
  type YamlValue,
} from "./yaml-subset.js";
import type {
  SdlcCiJob,
  SdlcCiPipeline,
  SdlcCiStep,
  SdlcCommand,
  SdlcCommandKind,
  SdlcContainer,
  SdlcDeployment,
  SdlcEvidence,
  SdlcEvidenceList,
  SdlcFeatureFlag,
  SdlcIac,
  SdlcMigration,
  SdlcObservability,
  SdlcParseFailure,
  SdlcProfile,
  SdlcQualityGate,
  SdlcRollback,
  SdlcStepKind,
  SdlcTestFramework,
  SdlcTestSuite,
} from "../schema/v1.js";

// ── Bounds ──────────────────────────────────────────────────────────────────

/**
 * Traversal bounds.
 *
 * A repository that trips any of these is pathological for this purpose, and
 * the analyzer must not be the reason an analysis hangs. Exported so tests can
 * assert each bound rather than trusting a comment.
 */
export const WALK_BOUNDS = {
  /** Directory depth below the project root. */
  maxDepth: 8,
  /** Files examined before the walk stops. */
  maxFiles: 5000,
  /** A file larger than this is skipped unread. */
  maxFileBytes: 1_000_000,
  /** Migration files read per migration directory when looking for a reverse step. */
  maxMigrationFilesRead: 50,
} as const;

/** Never descended into. Vendored trees restate a dependency's CI, not ours. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git", "node_modules", "vendor", "vendored", "third_party", "thirdparty",
  "dist", "build", "out", "target", "coverage", ".terraform", ".venv", "venv",
  "__pycache__", ".next", ".nuxt", ".cache", ".gradle", "Pods",
]);

// ── Triggers ────────────────────────────────────────────────────────────────

/**
 * Triggers that only fire when a person, or an external API call, starts the
 * pipeline. GitHub's `workflow_dispatch` and `repository_dispatch`, GitLab's
 * web/API/trigger-token refs (recorded as `manual`), Bitbucket's `custom`
 * pipelines. A pipeline whose only triggers are these never runs on a push or
 * a merge, so it is not automation however many deploy steps it carries.
 */
const MANUAL_TRIGGERS: ReadonlySet<string> = new Set([
  "workflow_dispatch", "repository_dispatch", "manual", "custom",
]);

/** A trigger that makes a pipeline callable from another, not one that starts it. */
const PASSIVE_TRIGGERS: ReadonlySet<string> = new Set(["workflow_call"]);

/**
 * Whether any trigger in the list starts the pipeline without a human.
 *
 * Deployment derivation and the scorecard's "runs automatically" criterion
 * both read this, so a dispatch-only workflow cannot earn automation points
 * on one surface and lose them on the other.
 */
export function hasAutomaticTrigger(triggers: readonly string[]): boolean {
  return triggers.some((t) => !MANUAL_TRIGGERS.has(t) && !PASSIVE_TRIGGERS.has(t));
}

// ── Evidence ────────────────────────────────────────────────────────────────

function one(
  kind: string,
  path: string,
  confidence: SdlcEvidence["confidence"],
  extra: { line?: number; excerpt?: string } = {},
): SdlcEvidence {
  const item: SdlcEvidence = { kind, path, confidence };
  if (extra.line !== undefined) item.line = extra.line;
  if (extra.excerpt !== undefined) item.excerpt = extra.excerpt.trim().slice(0, 200);
  return item;
}

function evidence(
  kind: string,
  path: string,
  confidence: SdlcEvidence["confidence"],
  extra: { line?: number; excerpt?: string } = {},
): SdlcEvidenceList {
  return [one(kind, path, confidence, extra)];
}

// ── The walk ────────────────────────────────────────────────────────────────

/** A file the walk kept, with its project-relative POSIX path. */
export interface WalkedFile {
  path: string;
  size: number;
}

/** What the walk found, and whether it stopped early. */
export interface WalkResult {
  files: WalkedFile[];
  /** True when `maxFiles` cut the traversal short. Nothing after the cap was seen. */
  truncated: boolean;
  /**
   * True when at least one directory sat deeper than `maxDepth` and was not
   * entered. Only that subtree is missing: its siblings and ancestors were
   * walked in full, so a deep Java package does not blank out the root
   * manifest beside it.
   */
  depthPruned: boolean;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/**
 * Walk the project for the files this analyzer reads.
 *
 * Bounded on depth, count and per-file size, and filtered by the project's own
 * ignore rules. Oversized files are recorded with their size and skipped
 * unread, so a caller can tell "not present" from "too big to read".
 */
export function walkProject(root: string, ignore: IgnoreFilter): WalkResult {
  const files: WalkedFile[] = [];
  let truncated = false;
  let depthPruned = false;

  const descend = (dir: string, depth: number): void => {
    if (truncated) return;
    if (depth > WALK_BOUNDS.maxDepth) {
      // Prune this subtree only. The file cap below is a global stop because
      // nothing past it was examined; a depth overflow says nothing about the
      // rest of the tree, so it must not cascade up through the ancestors.
      depthPruned = true;
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — not a finding, just nothing to see
    }
    entries.sort((a, b) => cmp(a.name, b.name));

    for (const entry of entries) {
      if (files.length >= WALK_BOUNDS.maxFiles) {
        truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      const rel = toPosix(relative(root, full));

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (ignore.ignores(rel + "/")) continue;
        descend(full, depth + 1);
        if (truncated) return;
        continue;
      }
      if (!entry.isFile()) continue;
      if (ignore.ignores(rel)) continue;

      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        continue;
      }
      files.push({ path: rel, size });
    }
  };

  descend(root, 0);
  files.sort((a, b) => cmp(a.path, b.path));
  return { files, truncated, depthPruned };
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** A reader that enforces the size bound and reports why it refused. */
class Reader {
  readonly failures: SdlcParseFailure[] = [];

  constructor(private readonly root: string) {}

  text(file: WalkedFile, kind: string): string | null {
    if (file.size > WALK_BOUNDS.maxFileBytes) {
      this.fail(file.path, kind, `file is ${file.size} bytes, over the ${WALK_BOUNDS.maxFileBytes} byte limit`);
      return null;
    }
    try {
      return readFileSync(join(this.root, file.path), "utf-8");
    } catch (error) {
      this.fail(file.path, kind, `could not be read: ${(error as Error).message}`);
      return null;
    }
  }

  yaml(file: WalkedFile, kind: string): YamlValue | null {
    const text = this.text(file, kind);
    if (text === null) return null;
    try {
      return parseYamlSubset(text);
    } catch (error) {
      const reason = error instanceof YamlSubsetError ? error.message : String(error);
      this.fail(file.path, kind, reason);
      return null;
    }
  }

  json<T>(file: WalkedFile, kind: string): T | null {
    const text = this.text(file, kind);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      this.fail(file.path, kind, `invalid JSON: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Read a file whose absence from the profile is not worth a parse failure —
   * a migration file scanned for a `down` step. Still size-bounded.
   */
  quietText(file: WalkedFile): string | null {
    if (file.size > WALK_BOUNDS.maxFileBytes) return null;
    try {
      return readFileSync(join(this.root, file.path), "utf-8");
    } catch {
      return null;
    }
  }

  fail(path: string, kind: string, reason: string): void {
    this.failures.push({ path, kind, reason });
  }
}

// ── Classifying a command ───────────────────────────────────────────────────

/**
 * Command text → what it does.
 *
 * Ordered: the first match wins, and the more specific patterns come first so
 * `npm run test:e2e` is a test rather than a run of something unknown.
 * Deliberately conservative — an unrecognised command classifies as `other`
 * rather than being guessed into a category it would then be counted in.
 */
const COMMAND_PATTERNS: Array<[RegExp, SdlcStepKind]> = [
  [/\b(checkout|actions\/checkout)\b/, "checkout"],
  [/\b(setup-node|setup-python|setup-go|setup-java|actions\/setup|use[- ]?node)\b/, "setup"],
  [/\b(npm|pnpm|yarn|bun)\s+(ci|install|i)\b|\bpip\s+install\b|\bbundle\s+install\b|\bgo\s+mod\s+download\b/, "install"],
  [/\btype-?check\b|\btsc\b/, "typecheck"],
  [/\blint\b|\beslint\b|\bruff\b|\bflake8\b|\bgolangci-lint\b|\bclippy\b/, "lint"],
  [/\btest\b|\bvitest\b|\bjest\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b|\brspec\b|\bphpunit\b/, "test"],
  [/\bmigrat\w*\b|\bdb:migrate\b|\balembic\b|\bflyway\b/, "migrate"],
  [/\bdeploy\b|\bkubectl\s+apply\b|\bhelm\s+(upgrade|install)\b|\bterraform\s+apply\b|\bserverless\s+deploy\b/, "deploy"],
  [/\bpublish\b|\bnpm\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\brelease\b/, "publish"],
  [/\bbuild\b|\bcompile\b|\bwebpack\b|\bvite\s+build\b|\bgo\s+build\b|\bmake\b/, "build"],
];

export function classifyCommand(text: string): SdlcStepKind {
  const lower = text.toLowerCase();
  for (const [pattern, kind] of COMMAND_PATTERNS) {
    if (pattern.test(lower)) return kind;
  }
  return "other";
}

/** The six kinds the `commands` section models, or null for anything else. */
function asCommandKind(kind: SdlcStepKind): SdlcCommandKind | null {
  switch (kind) {
    case "test":
    case "lint":
    case "typecheck":
    case "build":
    case "deploy":
    case "migrate":
      return kind;
    default:
      return null;
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

interface PackageJson {
  version?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
}

/**
 * One command per kind from a manifest's scripts.
 *
 * A script named exactly for its kind (`"test"`) beats one that merely
 * classifies as it (`"test:unit"`), whatever order the manifest lists them in:
 * `npm run test` is the command a consumer expects to find, and the first
 * script in file order is an accident of how the author typed the block.
 */
function commandsFromPackageJson(
  root: string,
  file: WalkedFile,
  pkg: PackageJson,
): SdlcCommand[] {
  const chosen = new Map<SdlcCommandKind, { exact: boolean; command: SdlcCommand }>();
  const scripts = pkg.scripts ?? {};
  const runner = detectRunner(root, file.path);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : undefined;

  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== "string") continue;
    // The script's own name is the stronger signal: `"test": "vitest run"` and
    // `"test": "./scripts/ci.sh"` are both the test command.
    const kind = asCommandKind(classifyCommand(name)) ?? asCommandKind(classifyCommand(body));
    if (!kind) continue;
    const exact = name === kind;
    const existing = chosen.get(kind);
    if (existing && (existing.exact || !exact)) continue;

    const command: SdlcCommand = {
      evidence: evidence("manifest-script", file.path, "certain", { excerpt: `"${name}": "${body}"` }),
      kind,
      command: `${runner} run ${name}`,
    };
    if (dir) command.cwd = dir;
    command.runner = runner;
    chosen.set(kind, { exact, command });
  }
  return [...chosen.values()].map((c) => c.command);
}

/**
 * The package manager a manifest's lockfile implies, defaulting to npm.
 *
 * `manifestPath` is project-relative, so the lookup has to be rejoined to the
 * absolute root — resolving it against the process working directory would
 * silently never find the lockfile and report npm for every project.
 */
function detectRunner(root: string, manifestPath: string): string {
  const dir = manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1) : "";
  for (const [lock, runner] of [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"]] as const) {
    if (existsSync(join(root, dir, lock))) return runner;
  }
  return "npm";
}

const MAKE_TARGET = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:(?!=)/;

function commandsFromMakefile(file: WalkedFile, text: string): SdlcCommand[] {
  const found: SdlcCommand[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = MAKE_TARGET.exec(lines[i]);
    if (!match) continue;
    const target = match[1];
    if (target === ".PHONY") continue;
    const kind = asCommandKind(classifyCommand(target));
    if (!kind) continue;
    found.push({
      evidence: evidence("make-target", file.path, "certain", { line: i + 1, excerpt: lines[i] }),
      kind,
      command: `make ${target}`,
      runner: "make",
    });
  }
  return found;
}

/** Script tables a pyproject can declare: PEP 621 `[project.scripts]` and the tool-specific ones. */
const PYPROJECT_SCRIPT_TABLES = /^\[(project\.scripts|tool\.(poetry|pdm|hatch\.envs\.[^\]]+)\.scripts)\]$/;

/** `[project.scripts]`, `[tool.poetry.scripts]` and friends, read as lines rather than TOML. */
function commandsFromPyproject(file: WalkedFile, text: string): SdlcCommand[] {
  const found: SdlcCommand[] = [];
  const lines = text.split(/\r?\n/);
  let inScripts = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("[")) {
      inScripts = PYPROJECT_SCRIPT_TABLES.test(line);
      continue;
    }
    if (!inScripts) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const name = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    const kind = asCommandKind(classifyCommand(name));
    if (!kind) continue;
    found.push({
      evidence: evidence("manifest-script", file.path, "certain", { line: i + 1, excerpt: lines[i] }),
      kind,
      command: name,
    });
  }
  return found;
}

/**
 * Go has no script block, so the commands are the toolchain's own.
 *
 * `likely` rather than `certain`: the module file proves this is a Go module,
 * not that anybody runs `go test` in CI. A CI step saying so would be
 * `certain`, and that evidence is collected separately.
 */
function commandsFromGoMod(file: WalkedFile): SdlcCommand[] {
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : undefined;
  const commands: SdlcCommand[] = [
    { evidence: evidence("file-present", file.path, "likely"), kind: "test", command: "go test ./...", runner: "go" },
    { evidence: evidence("file-present", file.path, "likely"), kind: "build", command: "go build ./...", runner: "go" },
  ];
  if (dir) for (const command of commands) command.cwd = dir;
  return commands;
}

// ── CI ──────────────────────────────────────────────────────────────────────

function stepFrom(raw: YamlValue): SdlcCiStep | null {
  if (typeof raw === "string") {
    return { run: raw, kind: classifyCommand(raw) };
  }
  if (!isMap(raw)) return null;

  // CircleCI's long form nests the command: `run: { name: Test, command: npm test }`.
  // The short form `run: npm test` and Actions' `run:` are the string case.
  const runMap = isMap(raw["run"]) ? raw["run"] : null;
  const name = stringAt(raw, "name") ?? (runMap ? stringAt(runMap, "name") : undefined);
  const run =
    stringAt(raw, "run") ??
    (runMap ? stringAt(runMap, "command") : undefined) ??
    stringAt(raw, "script") ??
    stringAt(raw, "command");
  const uses = stringAt(raw, "uses") ?? stringAt(raw, "image");
  if (run === undefined && uses === undefined && name === undefined) return null;

  const step: SdlcCiStep = { kind: classifyCommand([name, run, uses].filter(Boolean).join(" ")) };
  if (name !== undefined) step.name = name;
  if (run !== undefined) step.run = run;
  if (uses !== undefined) step.uses = uses;
  return step;
}

function stepsFrom(container: YamlValue, keys: string[]): SdlcCiStep[] {
  if (!isMap(container)) return [];
  for (const key of keys) {
    const raw = container[key];
    if (Array.isArray(raw)) {
      return raw.map(stepFrom).filter((s): s is SdlcCiStep => s !== null);
    }
    if (typeof raw === "string") {
      // A single block scalar of shell: one line, one step.
      return raw.split("\n").map((l) => l.trim()).filter(Boolean)
        .map((line) => ({ run: line, kind: classifyCommand(line) }));
    }
  }
  return [];
}

/** `environment: production` or `environment: { name: production }`. */
function declaredEnvironment(raw: YamlValue): string | undefined {
  if (!isMap(raw)) return undefined;
  const value = raw["environment"];
  if (typeof value === "string") return value;
  if (isMap(value)) return stringAt(value, "name");
  return undefined;
}

function jobFrom(name: string, raw: YamlValue, stepKeys: string[]): SdlcCiJob {
  const job: SdlcCiJob = { name, steps: stepsFrom(raw, stepKeys) };
  const needs = listAt(raw, "needs");
  if (needs.length > 0) job.needs = needs;
  const condition = stringAt(raw, "if") ?? stringAt(raw, "only") ?? stringAt(raw, "when");
  if (condition !== undefined) job.condition = condition;
  const environment = declaredEnvironment(raw);
  if (environment !== undefined) job.environment = environment;
  return job;
}

function parseGithubActions(file: WalkedFile, doc: YamlValue): SdlcCiPipeline {
  const jobsRaw = isMap(doc) && isMap(doc["jobs"]) ? doc["jobs"] : {};
  return {
    evidence: evidence("workflow-file", file.path, "certain"),
    provider: "github-actions",
    name: stringAt(doc, "name") ?? basename(file.path),
    triggers: listAt(doc, "on"),
    jobs: Object.entries(jobsRaw).map(([name, raw]) => jobFrom(name, raw, ["steps"])),
  };
}

/** GitLab's top level is jobs, mixed with reserved configuration keys. */
const GITLAB_RESERVED = new Set([
  "stages", "variables", "default", "include", "workflow", "image",
  "services", "before_script", "after_script", "cache", "pages",
]);

/**
 * What starts a GitLab pipeline.
 *
 * GitLab runs every job on every push unless `workflow:`, `rules:` or `only:`
 * narrow it, so the absence of all three is itself the trigger — an empty
 * list would read downstream as "nothing starts this pipeline", which is the
 * opposite of GitLab's default.
 */
function gitlabTriggers(doc: YamlValue, jobsRaw: Array<[string, YamlValue]>): string[] {
  const triggers = new Set<string>();
  const workflow = isMap(doc) ? doc["workflow"] : null;
  if (isMap(workflow) && workflow["rules"] !== undefined) triggers.add("rules");

  for (const [, raw] of jobsRaw) {
    if (!isMap(raw)) continue;
    if (raw["rules"] !== undefined) triggers.add("rules");
    const only = raw["only"];
    const onlyList = Array.isArray(only) ? only.filter((v): v is string => typeof v === "string") : [];
    if (isMap(only)) {
      if (only["refs"] !== undefined) triggers.add("push");
      if (only["variables"] !== undefined || only["changes"] !== undefined) triggers.add("rules");
    }
    for (const ref of onlyList) {
      if (ref === "tags") triggers.add("tag");
      else if (ref === "merge_requests") triggers.add("merge_request");
      else if (ref === "schedules") triggers.add("schedule");
      else if (ref === "web" || ref === "api" || ref === "triggers") triggers.add("manual");
      else triggers.add("push");
    }
  }
  if (triggers.size === 0) triggers.add("push");
  return [...triggers].sort(cmp);
}

function parseGitlabCi(file: WalkedFile, doc: YamlValue): SdlcCiPipeline {
  const jobs: SdlcCiJob[] = [];
  const jobsRaw: Array<[string, YamlValue]> = [];
  if (isMap(doc)) {
    for (const [name, raw] of Object.entries(doc)) {
      if (GITLAB_RESERVED.has(name) || name.startsWith(".")) continue;
      if (!isMap(raw)) continue;
      jobsRaw.push([name, raw]);
      jobs.push(jobFrom(name, raw, ["script", "run"]));
    }
  }
  return {
    evidence: evidence("workflow-file", file.path, "certain"),
    provider: "gitlab-ci",
    name: basename(file.path),
    triggers: gitlabTriggers(doc, jobsRaw),
    jobs,
  };
}

function parseCircleCi(file: WalkedFile, doc: YamlValue): SdlcCiPipeline {
  const jobsRaw = isMap(doc) && isMap(doc["jobs"]) ? doc["jobs"] : {};
  const workflows = isMap(doc) && isMap(doc["workflows"])
    ? Object.keys(doc["workflows"]).filter((k) => k !== "version").sort(cmp)
    : [];
  return {
    evidence: evidence("workflow-file", file.path, "certain"),
    provider: "circleci",
    name: basename(file.path),
    // Without a `workflows:` block CircleCI runs the `build` job on every push.
    triggers: workflows.length > 0 ? workflows : ["push"],
    jobs: Object.entries(jobsRaw).map(([name, raw]) => jobFrom(name, raw, ["steps"])),
  };
}

/**
 * Bitbucket nests steps under `pipelines.<trigger>`, where a trigger is either
 * a list of steps or a map of branch patterns to lists.
 */
function parseBitbucket(file: WalkedFile, doc: YamlValue): SdlcCiPipeline {
  const jobs: SdlcCiJob[] = [];
  const triggers: string[] = [];
  const pipelines = isMap(doc) ? doc["pipelines"] : null;

  if (isMap(pipelines)) {
    for (const [trigger, body] of Object.entries(pipelines)) {
      triggers.push(trigger);
      if (Array.isArray(body)) {
        jobs.push({ name: trigger, steps: bitbucketSteps(body) });
      } else if (isMap(body)) {
        for (const [pattern, inner] of Object.entries(body)) {
          if (!Array.isArray(inner)) continue;
          jobs.push({ name: `${trigger}:${pattern}`, steps: bitbucketSteps(inner) });
        }
      }
    }
  }

  return {
    evidence: evidence("workflow-file", file.path, "certain"),
    provider: "bitbucket-pipelines",
    name: basename(file.path),
    triggers,
    jobs,
  };
}

function bitbucketSteps(entries: YamlValue[]): SdlcCiStep[] {
  const steps: SdlcCiStep[] = [];
  for (const entry of entries) {
    const inner = isMap(entry) ? entry["step"] ?? entry["parallel"] ?? entry : entry;
    if (Array.isArray(inner)) {
      steps.push(...bitbucketSteps(inner));
      continue;
    }
    const name = stringAt(inner, "name");
    for (const script of stepsFrom(inner, ["script"])) {
      steps.push(name === undefined ? script : { ...script, name });
    }
  }
  return steps;
}

/**
 * Jenkinsfile is Groovy, not data. Read heuristically: `stage('X')` names a
 * job and `sh '...'` is a step. Evidence is `inferred` throughout, because a
 * line scan of a program is a guess about what it does at runtime.
 */
function parseJenkinsfile(file: WalkedFile, text: string): SdlcCiPipeline {
  const jobs: SdlcCiJob[] = [];
  const lines = text.split(/\r?\n/);
  let current: SdlcCiJob | null = null;

  for (const line of lines) {
    const stage = /\bstage\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
    if (stage) {
      current = { name: stage[1], steps: [] };
      jobs.push(current);
      continue;
    }
    const sh = /\b(?:sh|bat|powershell)\s+(?:'([^']+)'|"([^"]+)")/.exec(line);
    if (sh && current) {
      const command = sh[1] ?? sh[2];
      current.steps.push({ run: command, kind: classifyCommand(command) });
    }
  }

  return {
    evidence: evidence("file-present", file.path, "inferred"),
    provider: "jenkins",
    name: basename(file.path),
    triggers: /\btriggers\s*\{/.test(text) ? ["declared"] : [],
    jobs,
  };
}

// ── Deployments ─────────────────────────────────────────────────────────────

/** Tokens in a job name that name an environment, each mapped to its canonical form. */
const ENVIRONMENT_TOKENS: ReadonlyMap<string, string> = new Map([
  ["prod", "production"], ["production", "production"],
  ["staging", "staging"], ["stage", "staging"],
  ["preview", "preview"], ["dev", "dev"], ["test", "test"],
  ["qa", "qa"], ["uat", "uat"], ["canary", "canary"],
]);

/**
 * The environment a deploy job reaches.
 *
 * A declared `environment:` wins. Failing that, a token in the job name
 * (`deploy-staging`) is a strong convention. Failing both, `unknown` — never
 * the job name itself, because `deploy-api` and `deploy-worker` are two jobs
 * reaching one environment, and a scorecard counting environments must not
 * be told otherwise.
 */
function environmentOf(job: SdlcCiJob): string {
  if (job.environment !== undefined) return job.environment;
  for (const token of job.name.toLowerCase().split(/[^a-z0-9]+/)) {
    const canonical = ENVIRONMENT_TOKENS.get(token);
    if (canonical !== undefined) return canonical;
  }
  return "unknown";
}

// ── Section detectors ───────────────────────────────────────────────────────

const TEST_FRAMEWORK_DEPS: Array<[string, string]> = [
  ["vitest", "vitest"], ["jest", "jest"], ["mocha", "mocha"], ["jasmine", "jasmine"],
  ["@playwright/test", "playwright"], ["cypress", "cypress"], ["ava", "ava"],
  ["pytest", "pytest"], ["unittest2", "unittest"],
];

const SUITE_HINTS: Array<[RegExp, SdlcTestSuite["kind"]]> = [
  [/(^|\/)(e2e|end-to-end)(\/|$)|\.e2e\./, "e2e"],
  [/(^|\/)integration(\/|$)|\.integration\./, "integration"],
  [/(^|\/)contract(\/|$)|\.contract\./, "contract"],
  [/(^|\/)(perf|performance|bench)(\/|$)/, "performance"],
  [/(^|\/)smoke(\/|$)|\.smoke\./, "smoke"],
  [/(^|\/)(unit|tests?|__tests__|spec)(\/|$)|\.(test|spec)\./, "unit"],
];

/**
 * A file that can run as a test: a source file in a language a test runner
 * executes. A README, a JSON fixture or a snapshot under `tests/` is not
 * evidence that tests exist, however the directory is named.
 */
const TEST_SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py|go|rb|java|kt|kts|rs|cs|php|swift|scala|exs?|clj|dart)$/;

/**
 * Support files that live beside tests but are not tests: fixtures, snapshot
 * stores, mocks, helpers, setup files, runner configuration, declarations.
 */
const TEST_SUPPORT_PATH =
  /(^|\/)(?:fixtures?|__snapshots__|snapshots?|testdata|__mocks__|mocks?|helpers?|utils?|support)(\/|$)|\.d\.ts$|\.snap$|(^|\/)(?:vitest|jest|playwright|cypress|karma|mocha)\.config\.[^/]+$|(^|\/)setup[^/]*\.[cm]?[jt]sx?$/;

function isExecutableTestFile(path: string): boolean {
  return TEST_SOURCE_EXT.test(path) && !TEST_SUPPORT_PATH.test(path);
}

const OBSERVABILITY_DEPS: Array<[string, SdlcObservability["kind"], string]> = [
  ["@opentelemetry/api", "tracing", "opentelemetry"],
  ["@sentry/node", "error-reporting", "sentry"],
  ["@sentry/browser", "error-reporting", "sentry"],
  ["sentry-sdk", "error-reporting", "sentry"],
  ["prom-client", "metrics", "prometheus"],
  ["prometheus-client", "metrics", "prometheus"],
  ["pino", "logging", "pino"],
  ["winston", "logging", "winston"],
  ["bunyan", "logging", "bunyan"],
  ["datadog-metrics", "metrics", "datadog"],
  ["dd-trace", "tracing", "datadog"],
];

/** npm package → flag provider. */
const FEATURE_FLAG_DEPS: Array<[string, string]> = [
  ["launchdarkly-node-server-sdk", "launchdarkly"],
  ["launchdarkly-js-client-sdk", "launchdarkly"],
  ["@launchdarkly/node-server-sdk", "launchdarkly"],
  ["@launchdarkly/js-client-sdk", "launchdarkly"],
  ["unleash-client", "unleash"],
  ["@unleash/proxy-client-react", "unleash"],
  ["unleash-proxy-client", "unleash"],
  ["@splitsoftware/splitio", "split"],
  ["flagsmith", "flagsmith"],
  ["flagsmith-nodejs", "flagsmith"],
  ["@openfeature/server-sdk", "openfeature"],
  ["@openfeature/web-sdk", "openfeature"],
  ["@openfeature/js-sdk", "openfeature"],
  ["@openfeature/core", "openfeature"],
  ["statsig-node", "statsig"],
  ["statsig-js", "statsig"],
  ["statsig-react", "statsig"],
  ["@statsig/js-client", "statsig"],
  ["@statsig/react-bindings", "statsig"],
  ["@growthbook/growthbook", "growthbook"],
  ["@growthbook/growthbook-react", "growthbook"],
  ["posthog-node", "posthog"],
  ["posthog-js", "posthog"],
];

/** Go module path → flag provider, matched as a prefix of a `require` line. */
const FEATURE_FLAG_GO_MODULES: Array<[string, string]> = [
  ["github.com/launchdarkly/go-server-sdk", "launchdarkly"],
  ["gopkg.in/launchdarkly/go-server-sdk", "launchdarkly"],
  ["github.com/Unleash/unleash-client-go", "unleash"],
  ["github.com/open-feature/go-sdk", "openfeature"],
  ["github.com/statsig-io/go-sdk", "statsig"],
  ["github.com/growthbook/growthbook-golang", "growthbook"],
  ["github.com/posthog/posthog-go", "posthog"],
  ["github.com/Flagsmith/flagsmith-go-client", "flagsmith"],
  ["github.com/splitio/go-client", "split"],
];

/** Python distribution name (lowercased) → flag provider. */
const FEATURE_FLAG_PY_DISTS: Array<[string, string]> = [
  ["launchdarkly-server-sdk", "launchdarkly"],
  ["unleashclient", "unleash"],
  ["openfeature-sdk", "openfeature"],
  ["statsig", "statsig"],
  ["growthbook", "growthbook"],
  ["posthog", "posthog"],
  ["flagsmith", "flagsmith"],
  ["splitio-client", "split"],
];

/** `FEATURE_NEW_CHECKOUT=true` in a dotenv file: an in-house flag convention. */
const ENV_FLAG_LINE = /^\s*(?:export\s+)?((?:FEATURE|FF)_[A-Z0-9_]+)\s*=/;

interface MigrationSignal {
  tool: string;
  /** Where the migration files live, when the signal is a directory. */
  directory?: string;
  evidence: SdlcEvidence;
}

/**
 * Migration tooling, from the files that prove it.
 *
 * Each pattern names the tool its file is specific to. A bare `migrations/`
 * directory is `raw-sql` when it holds SQL and otherwise `unknown`: the
 * directory is real evidence of migrations, not of which tool runs them.
 */
const MIGRATION_FILE_SIGNALS: Array<[RegExp, string]> = [
  [/(^|\/)prisma\/migrations\/.+\.sql$/, "prisma"],
  [/(^|\/)knexfile\.(c|m)?[jt]s$/, "knex"],
  [/(^|\/)drizzle\.config\.(c|m)?[jt]s$/, "drizzle"],
  [/(^|\/)drizzle\/.+\.sql$/, "drizzle"],
  [/(^|\/)ormconfig\.(json|(c|m)?[jt]s|ya?ml)$/, "typeorm"],
  [/(^|\/)alembic\.ini$/, "alembic"],
  [/(^|\/)alembic\/versions\/.+\.py$/, "alembic"],
  [/(^|\/)flyway\.conf$/, "flyway"],
  [/(^|\/)(db\/migration|sql|migrations?)\/[VURB]\d[\w.]*__.+\.sql$/, "flyway"],
  [/(^|\/)liquibase\.properties$/, "liquibase"],
  [/(^|\/)[\w.-]*changelog[\w.-]*\.(xml|ya?ml|json|sql)$/i, "liquibase"],
  [/(^|\/)db\/migrate\/.+\.rb$/, "rails"],
  [/(^|\/)migrations?\/.+\.(up|down)\.sql$/, "golang-migrate"],
  [/(^|\/)(migrations?|sql\/migrations?)\/.+\.sql$/, "raw-sql"],
  [/(^|\/)migrations?\/.+/, "unknown"],
];

/** Dependency → migration tool, for tools whose files alone are ambiguous. */
const MIGRATION_DEPS: Array<[string, string]> = [
  ["prisma", "prisma"], ["@prisma/client", "prisma"],
  ["knex", "knex"],
  ["drizzle-orm", "drizzle"], ["drizzle-kit", "drizzle"],
  ["typeorm", "typeorm"],
];

/** Tools whose migration files can declare a reverse step, and what that looks like. */
const DOWN_MIGRATION_MARKERS: Record<string, RegExp> = {
  knex: /\b(exports\.down|export\s+(async\s+)?function\s+down|down\s*[:=]\s*(async\s*)?(\(|function))/,
  typeorm: /\b(public\s+)?(async\s+)?down\s*\(/,
  drizzle: /\b(exports\.down|export\s+(async\s+)?function\s+down)/,
  rails: /\bdef\s+(down|change)\b/,
  alembic: /\bdef\s+downgrade\b/,
};

/** Migration files that are a reverse step by name alone. */
const DOWN_MIGRATION_FILES: Record<string, RegExp> = {
  "golang-migrate": /\.down\.sql$/,
  flyway: /(^|\/)U\d[\w.]*__.+\.sql$/,
};

/** Rollout and release tooling, from the files that prove it. */
const RELEASE_TOOL_FILES: Array<[RegExp, string]> = [
  [/^\.changeset\/config\.json$/, "changesets"],
  [/^(release\.config\.(c|m)?js|\.releaserc(\.(json|ya?ml|js))?)$/, "semantic-release"],
  [/^(release-please-config\.json|\.release-please-manifest\.json)$/, "release-please"],
  [/^\.goreleaser\.ya?ml$/, "goreleaser"],
  [/^CHANGELOG\.md$/i, "changelog"],
];

// ── Assembly ────────────────────────────────────────────────────────────────

/** Everything the walk found, grouped by what it is. */
interface Classified {
  packageJsons: WalkedFile[];
  makefiles: WalkedFile[];
  pyprojects: WalkedFile[];
  requirements: WalkedFile[];
  goMods: WalkedFile[];
  cargoTomls: WalkedFile[];
  githubWorkflows: WalkedFile[];
  gitlabCi: WalkedFile[];
  circleCi: WalkedFile[];
  bitbucket: WalkedFile[];
  jenkinsfiles: WalkedFile[];
  dockerfiles: WalkedFile[];
  compose: WalkedFile[];
  k8s: WalkedFile[];
  appspecs: WalkedFile[];
  codeowners: WalkedFile[];
  preCommit: WalkedFile[];
  dotenvs: WalkedFile[];
  all: WalkedFile[];
}

function classify(files: WalkedFile[]): Classified {
  const out: Classified = {
    packageJsons: [], makefiles: [], pyprojects: [], requirements: [], goMods: [], cargoTomls: [],
    githubWorkflows: [], gitlabCi: [], circleCi: [], bitbucket: [],
    jenkinsfiles: [], dockerfiles: [], compose: [], k8s: [], appspecs: [],
    codeowners: [], preCommit: [], dotenvs: [], all: files,
  };

  for (const file of files) {
    const name = basename(file.path);
    const lower = name.toLowerCase();

    if (name === "package.json") out.packageJsons.push(file);
    else if (name === "Makefile" || name === "makefile" || name === "GNUmakefile") out.makefiles.push(file);
    else if (name === "pyproject.toml") out.pyprojects.push(file);
    else if (/^requirements[\w.-]*\.txt$/.test(lower)) out.requirements.push(file);
    else if (name === "go.mod") out.goMods.push(file);
    else if (name === "Cargo.toml") out.cargoTomls.push(file);
    else if (/^\.github\/workflows\/.+\.ya?ml$/.test(file.path)) out.githubWorkflows.push(file);
    else if (name === ".gitlab-ci.yml" || name === ".gitlab-ci.yaml") out.gitlabCi.push(file);
    else if (/^\.circleci\/config\.ya?ml$/.test(file.path)) out.circleCi.push(file);
    else if (name === "bitbucket-pipelines.yml" || name === "bitbucket-pipelines.yaml") out.bitbucket.push(file);
    else if (lower === "jenkinsfile" || lower.startsWith("jenkinsfile.")) out.jenkinsfiles.push(file);
    else if (lower === "dockerfile" || lower.startsWith("dockerfile.")) out.dockerfiles.push(file);
    else if (/^docker-compose(\.[\w-]+)?\.ya?ml$/.test(lower) || /^compose(\.[\w-]+)?\.ya?ml$/.test(lower)) out.compose.push(file);
    else if (lower === "appspec.yml" || lower === "appspec.yaml") out.appspecs.push(file);
    else if (name === "Chart.yaml" || /^(^|\/)(k8s|kubernetes|manifests|deploy|charts?|helm)\/.+\.ya?ml$/.test(file.path)) out.k8s.push(file);
    else if (name === "CODEOWNERS") out.codeowners.push(file);
    else if (name === ".pre-commit-config.yaml") out.preCommit.push(file);
    else if (/^\.env(\.[\w.-]+)?$/.test(name)) out.dotenvs.push(file);
  }
  return out;
}

/** Is a `version` string semver or calver? Undefined when it is neither. */
function versioningOf(version: unknown): "semver" | "calver" | undefined {
  if (typeof version !== "string") return undefined;
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!match) return undefined;
  const major = Number(match[1]);
  // A leading year is a date, not a major version — 2026.10 is calver,
  // 10.26 is semver. Four digits at the front is the only tell there is.
  return major >= 1900 && match[1].length === 4 ? "calver" : "semver";
}

/** The `version = "..."` line of a Cargo.toml or pyproject, outside dependency tables. */
function manifestVersionLine(text: string): string | undefined {
  let inRootTable = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inRootTable = /^\[(package|project|tool\.poetry)\]$/.test(line);
      continue;
    }
    if (!inRootTable) continue;
    const match = /^version\s*=\s*["']([^"']+)["']/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Build the SDLC profile for a project.
 *
 * Deterministic: no LLM, no network, no clock. The only inputs are the files
 * under `root` that survive the project's ignore rules and the walk bounds.
 */
export async function buildSdlcProfile(root: string): Promise<SdlcProfile> {
  const ignore = await loadIgnoreFilter(root);
  const walk = walkProject(root, ignore);
  const files = classify(walk.files);
  const reader = new Reader(root);

  if (walk.truncated) {
    reader.fail(".", "walk", `traversal stopped at ${WALK_BOUNDS.maxFiles} files; the profile may be incomplete`);
  }
  if (walk.depthPruned) {
    reader.fail(".", "walk", `directories deeper than ${WALK_BOUNDS.maxDepth} levels were not entered; anything under them is missing from the profile`);
  }

  const commands: SdlcCommand[] = [];
  const frameworks: SdlcTestFramework[] = [];
  const featureFlags: SdlcFeatureFlag[] = [];
  const observability: SdlcObservability[] = [];
  const migrationDeps: Array<{ tool: string; evidence: SdlcEvidence }> = [];
  const rollback: SdlcRollback[] = [];

  for (const file of files.packageJsons) {
    const pkg = reader.json<PackageJson>(file, "package.json");
    if (!pkg || typeof pkg !== "object") continue;
    commands.push(...commandsFromPackageJson(root, file, pkg));

    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [dep, name] of TEST_FRAMEWORK_DEPS) {
      if (deps[dep]) frameworks.push({ evidence: evidence("dependency", file.path, "certain", { excerpt: dep }), name });
    }
    for (const [dep, kind, provider] of OBSERVABILITY_DEPS) {
      if (deps[dep]) observability.push({ evidence: evidence("dependency", file.path, "certain", { excerpt: dep }), kind, provider });
    }
    for (const [dep, provider] of FEATURE_FLAG_DEPS) {
      if (deps[dep]) featureFlags.push({ evidence: evidence("dependency", file.path, "certain", { excerpt: dep }), provider });
    }
    for (const [dep, tool] of MIGRATION_DEPS) {
      if (deps[dep]) migrationDeps.push({ tool, evidence: one("dependency", file.path, "likely", { excerpt: dep }) });
    }
    const versioning = file.path === "package.json" ? versioningOf(pkg.version) : undefined;
    if (versioning) {
      rollback.push({
        evidence: evidence("manifest-version", file.path, "likely", { excerpt: `"version": "${String(pkg.version)}"` }),
        mechanism: "tagged-release",
        versioning,
      });
    }
  }

  for (const group of [files.cargoTomls, files.pyprojects]) {
    for (const file of group) {
      if (file.path.includes("/")) continue; // the root manifest names the release
      const text = reader.quietText(file);
      if (text === null) continue;
      const version = manifestVersionLine(text);
      const versioning = versioningOf(version);
      if (versioning) {
        rollback.push({
          evidence: evidence("manifest-version", file.path, "likely", { excerpt: `version = "${version}"` }),
          mechanism: "tagged-release",
          versioning,
        });
      }
    }
  }

  for (const file of files.makefiles) {
    const text = reader.text(file, "makefile");
    if (text !== null) commands.push(...commandsFromMakefile(file, text));
  }
  for (const file of files.pyprojects) {
    const text = reader.text(file, "pyproject.toml");
    if (text === null) continue;
    commands.push(...commandsFromPyproject(file, text));
    featureFlags.push(...pythonFlagDeps(file, text));
  }
  for (const file of files.requirements) {
    const text = reader.text(file, "requirements");
    if (text !== null) featureFlags.push(...pythonFlagDeps(file, text));
  }
  for (const file of files.goMods) {
    commands.push(...commandsFromGoMod(file));
    const text = reader.text(file, "go.mod");
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const [modulePath, provider] of FEATURE_FLAG_GO_MODULES) {
        if (lines[i].includes(modulePath)) {
          featureFlags.push({ evidence: evidence("dependency", file.path, "certain", { line: i + 1, excerpt: lines[i] }), provider });
        }
      }
    }
  }

  // ── In-house flags: FEATURE_* / FF_* in dotenv files ──
  for (const file of files.dotenvs) {
    const text = reader.quietText(file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    const keys: string[] = [];
    let firstLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const match = ENV_FLAG_LINE.exec(lines[i]);
      if (!match) continue;
      if (keys.length === 0) firstLine = i + 1;
      keys.push(match[1]);
    }
    if (keys.length === 0) continue;
    featureFlags.push({
      evidence: evidence("env-var-convention", file.path, "inferred", { line: firstLine, excerpt: lines[firstLine - 1] }),
      provider: "in-house",
      flags: [...new Set(keys)].sort(cmp),
    });
  }

  // ── CI ──
  const ci: SdlcCiPipeline[] = [];
  const yamlPipelines: Array<[WalkedFile[], string, (f: WalkedFile, d: YamlValue) => SdlcCiPipeline]> = [
    [files.githubWorkflows, "github-actions", parseGithubActions],
    [files.gitlabCi, "gitlab-ci", parseGitlabCi],
    [files.circleCi, "circleci", parseCircleCi],
    [files.bitbucket, "bitbucket-pipelines", parseBitbucket],
  ];
  for (const [group, kind, parse] of yamlPipelines) {
    for (const file of group) {
      const doc = reader.yaml(file, kind);
      if (doc !== null) ci.push(parse(file, doc));
    }
  }
  for (const file of files.jenkinsfiles) {
    const text = reader.text(file, "jenkins");
    if (text !== null) ci.push(parseJenkinsfile(file, text));
  }

  // ── CD, derived from CI steps ──
  const cd: SdlcDeployment[] = [];
  for (const pipeline of ci) {
    for (const job of pipeline.jobs) {
      if (!job.steps.some((s) => s.kind === "deploy")) continue;
      cd.push({
        evidence: evidence("workflow-job", pipeline.evidence[0].path, "likely", { excerpt: job.name }),
        environment: environmentOf(job),
        mechanism: pipeline.provider,
        // A condition on the job is a gate of some sort, but whether it means
        // "a human approves" is a judgement this does not make.
        ...(job.condition === undefined ? {} : { requiresApproval: false }),
        // A deploy job in a workflow that only a person can start is a deploy
        // button, not a deployment pipeline.
        automated: hasAutomaticTrigger(pipeline.triggers),
      });
    }
  }

  // ── Containers ──
  const containers: SdlcContainer[] = [];
  for (const file of files.dockerfiles) {
    const text = reader.text(file, "dockerfile");
    if (text === null) continue;
    const froms = [...text.matchAll(/^\s*FROM\s+(\S+)/gim)].map((m) => m[1]);
    const container: SdlcContainer = {
      evidence: evidence("file-present", file.path, "certain"),
      path: file.path,
      baseImages: froms,
      multiStage: froms.length > 1,
    };
    if (files.compose.length > 0) container.orchestration = "compose";
    else if (files.k8s.some((f) => basename(f.path) === "Chart.yaml")) container.orchestration = "helm";
    else if (files.k8s.length > 0) container.orchestration = "kubernetes";
    containers.push(container);
  }

  // ── IaC — reusing the existing discovery, not a second parser ──
  // The discovery does its own walk, which knows nothing of .gitignore,
  // .sourcevisionignore or this walk's bounds. Restricting it to the files
  // this walk accepted keeps an ignored fixture's Terraform from being
  // claimed as the project's own infrastructure practice.
  const walked = new Set(walk.files.map((f) => f.path));
  const discovered = discoverFromIaC(root, { accept: (path) => walked.has(path) });
  const iac: SdlcIac[] = [];
  const iacByTool = new Map<string, string>();
  for (const resource of discovered.infrastructure) {
    if (resource.origin === "config") continue;
    const tool = resource.origin.endsWith(".tf") ? "terraform" : "cloudformation";
    if (!iacByTool.has(tool)) iacByTool.set(tool, resource.origin);
  }
  for (const [tool, path] of [...iacByTool].sort(([a], [b]) => cmp(a, b))) {
    const root_ = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
    const entry: SdlcIac = { evidence: evidence("file-present", path, "certain"), tool };
    if (root_) entry.root = root_;
    iac.push(entry);
  }

  // ── Migrations ──
  const migrations = detectMigrations(walk.files, migrationDeps, reader);

  // ── Rollback levers ──
  for (const file of walk.files) {
    for (const [pattern, tool] of RELEASE_TOOL_FILES) {
      if (!pattern.test(file.path)) continue;
      rollback.push({ evidence: evidence("file-present", file.path, "likely"), mechanism: "tagged-release", tool });
    }
  }
  for (const file of files.k8s) {
    if (basename(file.path) === "Chart.yaml") {
      rollback.push({ evidence: evidence("file-present", file.path, "likely"), mechanism: "redeploy-previous", tool: "helm" });
      continue;
    }
    const text = reader.quietText(file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const kind = /^\s*kind:\s*(\w+)\s*$/.exec(lines[i]);
      if (!kind) continue;
      if (kind[1] === "Rollout") {
        const strategy = /^\s*blueGreen:/m.test(text) ? "blue-green" : /^\s*canary:/m.test(text) ? "canary" : "redeploy-previous";
        rollback.push({ evidence: evidence("manifest-kind", file.path, "likely", { line: i + 1, excerpt: lines[i] }), mechanism: strategy, tool: "argo-rollouts" });
      } else if (kind[1] === "Deployment") {
        rollback.push({ evidence: evidence("manifest-kind", file.path, "likely", { line: i + 1, excerpt: lines[i] }), mechanism: "redeploy-previous", tool: "kubernetes" });
      }
    }
  }
  for (const file of files.appspecs) {
    rollback.push({ evidence: evidence("file-present", file.path, "likely"), mechanism: "redeploy-previous", tool: "codedeploy" });
  }
  for (const migration of migrations) {
    if (!migration.reversible) continue;
    rollback.push({ evidence: [...migration.evidence] as SdlcEvidenceList, mechanism: "db-down-migration", tool: migration.tool });
  }
  for (const flag of dedupeBy(featureFlags, (f) => f.provider)) {
    rollback.push({ evidence: [...flag.evidence] as SdlcEvidenceList, mechanism: "feature-flag", tool: flag.provider });
  }

  // ── Quality gates ──
  const qualityGates: SdlcQualityGate[] = [];
  for (const file of files.codeowners) {
    qualityGates.push({ evidence: evidence("file-present", file.path, "certain"), kind: "codeowners", blocking: false });
  }
  for (const file of files.preCommit) {
    qualityGates.push({ evidence: evidence("file-present", file.path, "certain"), kind: "pre-commit-hook", blocking: true });
  }

  // ── Test suites, from paths ──
  const suiteCounts = new Map<SdlcTestSuite["kind"], { count: number; first: string }>();
  for (const file of walk.files) {
    if (!isExecutableTestFile(file.path)) continue;
    if (!/\.(test|spec)\.[jt]sx?$|_test\.go$|(^|\/)test_[^/]+\.py$|(^|\/)tests?\//.test(file.path)) continue;
    for (const [pattern, kind] of SUITE_HINTS) {
      if (!pattern.test(file.path)) continue;
      const existing = suiteCounts.get(kind);
      if (existing) existing.count++;
      else suiteCounts.set(kind, { count: 1, first: file.path });
      break;
    }
  }
  const suites: SdlcTestSuite[] = [...suiteCounts.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([kind, { count, first }]) => ({
      evidence: evidence("file-present", first, "likely"),
      kind,
      fileCount: count,
    }));

  return {
    schemaVersion: "1.0.0",
    projectDir: root,
    commands: dedupeCommands(commands),
    tests: { frameworks: dedupeBy(frameworks, (f) => f.name), suites },
    ci,
    cd,
    rollback: dedupeBy(rollback, (r) => `${r.mechanism}\u0000${r.tool ?? ""}\u0000${r.versioning ?? ""}`),
    migrations,
    featureFlags: dedupeBy(featureFlags, (f) => f.provider),
    qualityGates,
    observability: dedupeBy(observability, (o) => `${o.kind}:${o.provider}`),
    containers,
    iac,
    parseFailures: reader.failures,
  };
}

/** Flag SDKs named in a pyproject or requirements file, one evidence line each. */
function pythonFlagDeps(file: WalkedFile, text: string): SdlcFeatureFlag[] {
  const found: SdlcFeatureFlag[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase();
    if (line === "" || line.startsWith("#")) continue;
    for (const [dist, provider] of FEATURE_FLAG_PY_DISTS) {
      // `statsig>=1.0`, `"statsig",`, `statsig = "^1"`: the name must start a token.
      if (new RegExp(`(^|["'\\s])${dist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-])`).test(line)) {
        found.push({ evidence: evidence("dependency", file.path, "certain", { line: i + 1, excerpt: lines[i] }), provider });
      }
    }
  }
  return found;
}

/**
 * Migration tooling, one entry per migration directory plus one per tool
 * named only by a dependency.
 *
 * A directory is claimed by the most specific signal that matches a file in
 * it: `prisma/migrations/x.sql` is prisma, not raw SQL. Reversibility is read
 * from the files themselves — a `down` function, a `.down.sql` twin, a Flyway
 * undo script — because "migrations exist" and "migrations can be undone" are
 * different facts and the scorecard asks about the second.
 */
function detectMigrations(
  files: WalkedFile[],
  deps: Array<{ tool: string; evidence: SdlcEvidence }>,
  reader: Reader,
): SdlcMigration[] {
  const byDir = new Map<string, { tool: string; rank: number; evidence: SdlcEvidence; members: WalkedFile[] }>();

  for (const file of files) {
    for (let rank = 0; rank < MIGRATION_FILE_SIGNALS.length; rank++) {
      const [pattern, tool] = MIGRATION_FILE_SIGNALS[rank];
      if (!pattern.test(file.path)) continue;
      const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ".";
      const existing = byDir.get(dir);
      if (existing === undefined) {
        byDir.set(dir, {
          tool, rank, members: [file],
          evidence: one("file-present", file.path, tool === "unknown" ? "inferred" : "likely"),
        });
      } else {
        existing.members.push(file);
        if (rank < existing.rank) {
          existing.tool = tool;
          existing.rank = rank;
          existing.evidence = one("file-present", file.path, "likely");
        }
      }
      break;
    }
  }

  // A tool config file beside a bare `migrations/` names the tool for it:
  // `knexfile.js` at the root claims `migrations/` at the root.
  const configTools = new Map<string, { tool: string; evidence: SdlcEvidence }>();
  for (const [dir, entry] of byDir) {
    if (!/^(knexfile|drizzle\.config|ormconfig|alembic\.ini|flyway\.conf|liquibase\.properties)/.test(basename(entry.members[0].path))) continue;
    const parent = dir === "." ? "" : `${dir}/`;
    configTools.set(parent, { tool: entry.tool, evidence: entry.evidence });
  }
  for (const [dir, entry] of byDir) {
    if (entry.tool !== "unknown" && entry.tool !== "raw-sql") continue;
    const parent = dir.includes("/") ? `${dir.slice(0, dir.lastIndexOf("/"))}/` : "";
    const config = configTools.get(parent);
    if (config) {
      entry.tool = config.tool;
      entry.evidence = config.evidence;
    }
  }
  // Failing a config file, a migration dependency names the tool for a bare
  // directory of script files — the one whose API the files use when they say
  // so, else the only candidate. SQL files stay raw-sql: knex does not write SQL.
  for (const entry of byDir.values()) {
    if (entry.tool !== "unknown") continue;
    const candidates = deps.filter((d) => d.tool !== "prisma");
    if (candidates.length === 0) continue;
    const named = candidates.length === 1 ? candidates[0] : migrationDepNamedInFiles(candidates, entry.members, reader);
    const dep = named ?? candidates[0];
    entry.tool = dep.tool;
    entry.evidence = dep.evidence;
  }

  const migrations: SdlcMigration[] = [];
  const toolsWithDir = new Set<string>();
  for (const [dir, entry] of [...byDir].sort(([a], [b]) => cmp(a, b))) {
    // The config files are signals about a directory, not migration directories themselves.
    if (/^(knexfile|drizzle\.config|ormconfig|alembic\.ini|flyway\.conf|liquibase\.properties)/.test(basename(entry.members[0].path)) && entry.members.length === 1) {
      toolsWithDir.add(entry.tool);
      continue;
    }
    const migration: SdlcMigration = { evidence: [entry.evidence], tool: entry.tool, directory: dir };
    const reverse = reverseEvidence(entry.tool, entry.members, reader);
    if (reverse) {
      migration.reversible = true;
      migration.evidence.push(reverse);
    } else if (entry.tool in DOWN_MIGRATION_MARKERS || entry.tool in DOWN_MIGRATION_FILES) {
      migration.reversible = false;
    }
    migrations.push(migration);
    toolsWithDir.add(entry.tool);
  }

  for (const dep of deps) {
    if (toolsWithDir.has(dep.tool)) continue;
    toolsWithDir.add(dep.tool);
    migrations.push({ evidence: [dep.evidence], tool: dep.tool });
  }
  return migrations;
}

/** What a migration file says when it is written against a given tool's API. */
const MIGRATION_API_MARKERS: Record<string, RegExp> = {
  typeorm: /\bMigrationInterface\b|from\s+["']typeorm["']/,
  knex: /\bknex\b/i,
  drizzle: /drizzle/i,
};

/** The dependency whose API the directory's files mention, if any does. */
function migrationDepNamedInFiles<T extends { tool: string }>(
  candidates: T[],
  members: WalkedFile[],
  reader: Reader,
): T | undefined {
  for (const member of members.slice(0, WALK_BOUNDS.maxMigrationFilesRead)) {
    const text = reader.quietText(member);
    if (text === null) continue;
    for (const candidate of candidates) {
      const marker = MIGRATION_API_MARKERS[candidate.tool];
      if (marker && marker.test(text)) return candidate;
    }
  }
  return undefined;
}

/** The first file in a migration directory that proves a reverse step exists. */
function reverseEvidence(tool: string, members: WalkedFile[], reader: Reader): SdlcEvidence | null {
  const byName = DOWN_MIGRATION_FILES[tool];
  if (byName) {
    const twin = members.find((m) => byName.test(m.path));
    return twin ? one("down-migration", twin.path, "certain") : null;
  }
  const marker = DOWN_MIGRATION_MARKERS[tool];
  if (!marker) return null;
  for (const member of members.slice(0, WALK_BOUNDS.maxMigrationFilesRead)) {
    const text = reader.quietText(member);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (marker.test(lines[i])) return one("down-migration", member.path, "certain", { line: i + 1, excerpt: lines[i] });
    }
  }
  return null;
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()].sort((a, b) => cmp(key(a), key(b)));
}

/** One command per kind per working directory, ordered for stable output. */
function dedupeCommands(commands: SdlcCommand[]): SdlcCommand[] {
  return dedupeBy(commands, (c) => `${c.cwd ?? ""}\u0000${c.kind}`);
}

/** Strip the absolute root before the profile is written. */
export function stripSdlcProfileForDisk(profile: SdlcProfile): SdlcProfile {
  const { projectDir: _omitted, ...rest } = profile;
  return rest as SdlcProfile;
}
