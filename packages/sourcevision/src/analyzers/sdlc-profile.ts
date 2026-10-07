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
 * produce byte-identical output. An enrichment pass may later refine a
 * genuinely ambiguous judgement ("does this job deploy?"), but the
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
  SdlcEvidence,
  SdlcEvidenceList,
  SdlcIac,
  SdlcMigration,
  SdlcObservability,
  SdlcParseFailure,
  SdlcProfile,
  SdlcQualityGate,
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
} as const;

/** Never descended into. Vendored trees restate a dependency's CI, not ours. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git", "node_modules", "vendor", "vendored", "third_party", "thirdparty",
  "dist", "build", "out", "target", "coverage", ".terraform", ".venv", "venv",
  "__pycache__", ".next", ".nuxt", ".cache", ".gradle", "Pods",
]);

// ── Evidence ────────────────────────────────────────────────────────────────

function evidence(
  kind: string,
  path: string,
  confidence: SdlcEvidence["confidence"],
  extra: { line?: number; excerpt?: string } = {},
): SdlcEvidenceList {
  const one: SdlcEvidence = { kind, path, confidence };
  if (extra.line !== undefined) one.line = extra.line;
  if (extra.excerpt !== undefined) one.excerpt = extra.excerpt.trim().slice(0, 200);
  return [one];
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
  /** True when `maxFiles` or `maxDepth` cut the traversal short. */
  truncated: boolean;
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

  const descend = (dir: string, depth: number): void => {
    if (truncated) return;
    if (depth > WALK_BOUNDS.maxDepth) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — not a finding, just nothing to see
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

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
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated };
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
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
}

function commandsFromPackageJson(
  root: string,
  file: WalkedFile,
  pkg: PackageJson,
): SdlcCommand[] {
  const found: SdlcCommand[] = [];
  const scripts = pkg.scripts ?? {};
  const runner = detectRunner(root, file.path);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : undefined;

  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== "string") continue;
    // The script's own name is the stronger signal: `"test": "vitest run"` and
    // `"test": "./scripts/ci.sh"` are both the test command.
    const kind = asCommandKind(classifyCommand(name)) ?? asCommandKind(classifyCommand(body));
    if (!kind) continue;
    const command: SdlcCommand = {
      evidence: evidence("manifest-script", file.path, "certain", { excerpt: `"${name}": "${body}"` }),
      kind,
      command: `${runner} run ${name}`,
    };
    if (dir) command.cwd = dir;
    command.runner = runner;
    found.push(command);
  }
  return found;
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

/** `[tool.poetry.scripts]` and friends, read as lines rather than TOML. */
function commandsFromPyproject(file: WalkedFile, text: string): SdlcCommand[] {
  const found: SdlcCommand[] = [];
  const lines = text.split(/\r?\n/);
  let inScripts = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("[")) {
      inScripts = /^\[tool\.(poetry|pdm|hatch\.envs\.[^\]]+)\.scripts\]$/.test(line);
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
  return [
    { evidence: evidence("file-present", file.path, "likely"), kind: "test", command: "go test ./...", runner: "go" },
    { evidence: evidence("file-present", file.path, "likely"), kind: "build", command: "go build ./...", runner: "go" },
  ];
}

// ── CI ──────────────────────────────────────────────────────────────────────

function stepFrom(raw: YamlValue): SdlcCiStep | null {
  if (typeof raw === "string") {
    return { run: raw, kind: classifyCommand(raw) };
  }
  if (!isMap(raw)) return null;

  const name = stringAt(raw, "name");
  const run = stringAt(raw, "run") ?? stringAt(raw, "script") ?? stringAt(raw, "command");
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

function jobFrom(name: string, raw: YamlValue, stepKeys: string[]): SdlcCiJob {
  const job: SdlcCiJob = { name, steps: stepsFrom(raw, stepKeys) };
  const needs = listAt(raw, "needs");
  if (needs.length > 0) job.needs = needs;
  const condition = stringAt(raw, "if") ?? stringAt(raw, "only") ?? stringAt(raw, "when");
  if (condition !== undefined) job.condition = condition;
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

function parseGitlabCi(file: WalkedFile, doc: YamlValue): SdlcCiPipeline {
  const jobs: SdlcCiJob[] = [];
  if (isMap(doc)) {
    for (const [name, raw] of Object.entries(doc)) {
      if (GITLAB_RESERVED.has(name) || name.startsWith(".")) continue;
      if (!isMap(raw)) continue;
      jobs.push(jobFrom(name, raw, ["script", "run"]));
    }
  }
  return {
    evidence: evidence("workflow-file", file.path, "certain"),
    provider: "gitlab-ci",
    name: basename(file.path),
    triggers: listAt(doc, "workflow").length > 0 ? ["rules"] : [],
    jobs,
  };
}

function parseCircleCi(file: WalkedFile, doc: YamlValue): SdlcCiPipeline {
  const jobsRaw = isMap(doc) && isMap(doc["jobs"]) ? doc["jobs"] : {};
  return {
    evidence: evidence("workflow-file", file.path, "certain"),
    provider: "circleci",
    name: basename(file.path),
    triggers: isMap(doc) && isMap(doc["workflows"]) ? Object.keys(doc["workflows"]).filter((k) => k !== "version") : [],
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

const FEATURE_FLAG_DEPS: Array<[string, string]> = [
  ["launchdarkly-node-server-sdk", "launchdarkly"],
  ["launchdarkly-js-client-sdk", "launchdarkly"],
  ["unleash-client", "unleash"],
  ["@splitsoftware/splitio", "split"],
  ["flagsmith", "flagsmith"],
];

const MIGRATION_TOOLS: Array<[RegExp, string]> = [
  [/(^|\/)prisma\/migrations(\/|$)/, "prisma"],
  [/(^|\/)migrations?(\/|$)/, "unknown"],
  [/(^|\/)alembic(\/|$)/, "alembic"],
  [/(^|\/)db\/migrate(\/|$)/, "rails"],
];

// ── Assembly ────────────────────────────────────────────────────────────────

/** Everything the walk found, grouped by what it is. */
interface Classified {
  packageJsons: WalkedFile[];
  makefiles: WalkedFile[];
  pyprojects: WalkedFile[];
  goMods: WalkedFile[];
  githubWorkflows: WalkedFile[];
  gitlabCi: WalkedFile[];
  circleCi: WalkedFile[];
  bitbucket: WalkedFile[];
  jenkinsfiles: WalkedFile[];
  dockerfiles: WalkedFile[];
  compose: WalkedFile[];
  k8s: WalkedFile[];
  codeowners: WalkedFile[];
  preCommit: WalkedFile[];
  all: WalkedFile[];
}

function classify(files: WalkedFile[]): Classified {
  const out: Classified = {
    packageJsons: [], makefiles: [], pyprojects: [], goMods: [],
    githubWorkflows: [], gitlabCi: [], circleCi: [], bitbucket: [],
    jenkinsfiles: [], dockerfiles: [], compose: [], k8s: [],
    codeowners: [], preCommit: [], all: files,
  };

  for (const file of files) {
    const name = basename(file.path);
    const lower = name.toLowerCase();

    if (name === "package.json") out.packageJsons.push(file);
    else if (name === "Makefile" || name === "makefile" || name === "GNUmakefile") out.makefiles.push(file);
    else if (name === "pyproject.toml") out.pyprojects.push(file);
    else if (name === "go.mod") out.goMods.push(file);
    else if (/^\.github\/workflows\/.+\.ya?ml$/.test(file.path)) out.githubWorkflows.push(file);
    else if (name === ".gitlab-ci.yml" || name === ".gitlab-ci.yaml") out.gitlabCi.push(file);
    else if (/^\.circleci\/config\.ya?ml$/.test(file.path)) out.circleCi.push(file);
    else if (name === "bitbucket-pipelines.yml" || name === "bitbucket-pipelines.yaml") out.bitbucket.push(file);
    else if (lower === "jenkinsfile" || lower.startsWith("jenkinsfile.")) out.jenkinsfiles.push(file);
    else if (lower === "dockerfile" || lower.startsWith("dockerfile.")) out.dockerfiles.push(file);
    else if (/^docker-compose(\.[\w-]+)?\.ya?ml$/.test(lower) || /^compose(\.[\w-]+)?\.ya?ml$/.test(lower)) out.compose.push(file);
    else if (name === "Chart.yaml" || /^(^|\/)(k8s|kubernetes|manifests)\//.test(file.path)) out.k8s.push(file);
    else if (name === "CODEOWNERS") out.codeowners.push(file);
    else if (name === ".pre-commit-config.yaml") out.preCommit.push(file);
  }
  return out;
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
    reader.fail(".", "walk", `traversal stopped at the bounds (depth ${WALK_BOUNDS.maxDepth}, ${WALK_BOUNDS.maxFiles} files); the profile may be incomplete`);
  }

  const commands: SdlcCommand[] = [];
  const frameworks: SdlcTestFramework[] = [];
  const featureFlags: SdlcProfile["featureFlags"] = [];
  const observability: SdlcObservability[] = [];

  for (const file of files.packageJsons) {
    const pkg = reader.json<PackageJson>(file, "package.json");
    if (!pkg) continue;
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
  }

  for (const file of files.makefiles) {
    const text = reader.text(file, "makefile");
    if (text !== null) commands.push(...commandsFromMakefile(file, text));
  }
  for (const file of files.pyprojects) {
    const text = reader.text(file, "pyproject.toml");
    if (text !== null) commands.push(...commandsFromPyproject(file, text));
  }
  for (const file of files.goMods) {
    commands.push(...commandsFromGoMod(file));
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

  // ── CD and rollback, derived from CI steps ──
  const cd: SdlcProfile["cd"] = [];
  for (const pipeline of ci) {
    for (const job of pipeline.jobs) {
      if (!job.steps.some((s) => s.kind === "deploy")) continue;
      cd.push({
        evidence: evidence("workflow-job", pipeline.evidence[0].path, "likely", { excerpt: job.name }),
        environment: job.name,
        mechanism: pipeline.provider,
        // A condition on the job is a gate of some sort, but whether it means
        // "a human approves" is a judgement this does not make.
        ...(job.condition === undefined ? {} : { requiresApproval: false }),
        automated: pipeline.triggers.length > 0,
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
  const discovered = discoverFromIaC(root);
  const iac: SdlcIac[] = [];
  const iacByTool = new Map<string, string>();
  for (const resource of discovered.infrastructure) {
    if (resource.origin === "config") continue;
    const tool = resource.origin.endsWith(".tf") ? "terraform" : "cloudformation";
    if (!iacByTool.has(tool)) iacByTool.set(tool, resource.origin);
  }
  for (const [tool, path] of [...iacByTool].sort(([a], [b]) => a.localeCompare(b))) {
    const root_ = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
    const entry: SdlcIac = { evidence: evidence("file-present", path, "certain"), tool };
    if (root_) entry.root = root_;
    iac.push(entry);
  }

  // ── Migrations ──
  const migrations: SdlcMigration[] = [];
  const seenMigrationDirs = new Set<string>();
  for (const file of walk.files) {
    for (const [pattern, tool] of MIGRATION_TOOLS) {
      if (!pattern.test(file.path)) continue;
      const dir = file.path.slice(0, file.path.lastIndexOf("/"));
      if (seenMigrationDirs.has(dir)) continue;
      seenMigrationDirs.add(dir);
      migrations.push({
        evidence: evidence("directory-present", file.path, tool === "unknown" ? "inferred" : "likely"),
        tool,
        directory: dir,
      });
      break;
    }
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
    .sort(([a], [b]) => a.localeCompare(b))
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
    rollback: [],
    migrations,
    featureFlags: dedupeBy(featureFlags, (f) => f.provider),
    qualityGates,
    observability: dedupeBy(observability, (o) => `${o.kind}:${o.provider}`),
    containers,
    iac,
    parseFailures: reader.failures,
  };
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

/** One command per kind per working directory, ordered for stable output. */
function dedupeCommands(commands: SdlcCommand[]): SdlcCommand[] {
  return dedupeBy(commands, (c) => `${c.cwd ?? ""} ${c.kind}`);
}

/** Strip the absolute root before the profile is written. */
export function stripSdlcProfileForDisk(profile: SdlcProfile): SdlcProfile {
  const { projectDir: _omitted, ...rest } = profile;
  return rest as SdlcProfile;
}
