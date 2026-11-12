/**
 * The benchmark's matrix: cases, fixtures, flags, and the plan `--dry-run`
 * prints. Pure: callers pass the manifests and a file-exists check.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { selectAffected } from "../../lib/select-suites.mjs";

/** Thrown for a flag or fixture problem the operator must fix; printed without a stack. */
export class BenchUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "BenchUsageError";
  }
}

/** The test worker cap the pilot uses (`hench.testGate.maxWorkers` in this repository). */
export const PILOT_MAX_WORKERS = "2";

/**
 * Cases. `concurrent` cases run `--concurrency` worktrees at once; the others one.
 * `maxWorkers: null` leaves NDX_TEST_MAX_WORKERS unset, so A and C are the
 * pre-wave-1 behaviour on the current commit.
 */
export const CASES = {
  A: { id: "A", label: "solo, uncapped, no slot", concurrent: false, maxWorkers: null, slot: false },
  B: { id: "B", label: "solo, capped, no slot", concurrent: false, maxWorkers: PILOT_MAX_WORKERS, slot: false },
  C: { id: "C", label: "parallel, uncapped, no slot", concurrent: true, maxWorkers: null, slot: false },
  D: { id: "D", label: "parallel, capped, host slot", concurrent: true, maxWorkers: PILOT_MAX_WORKERS, slot: true },
};

/**
 * Fixtures: files a comment is appended to. Selection depends only on changed
 * paths, so a comment produces the same suite workload as a real edit.
 */
export const FIXTURES = {
  hench: { files: ["packages/hench/src/process/limiter.ts"], note: "one hench source file" },
  "llm-client": { files: ["packages/llm-client/src/system-memory.ts"], note: "foundation package; fans out to dependents" },
  web: { files: ["packages/web/src/viewer/route-state.ts"], note: "web viewer (largest package suite)" },
  "core-cli": { files: ["packages/core/cli.js"], note: "root e2e suite" },
  docs: { files: ["docs/architecture/overview.md"], note: "prose page: empty selection, overhead only" },
};

export const DEFAULT_FIXTURES = ["hench", "llm-client", "web"];

/**
 * Rough per-suite durations on a quiet machine, seconds, for the estimate
 * only, scaled to TESTING.md's ~9 min full pass. Real numbers come from the run itself.
 */
export const SUITE_ESTIMATE_SECONDS = {
  root: 180,
  "root-policy": 3,
  "root-drift": 15,
  "root-docs": 3,
  "root-extensions": 10,
  web: 120,
  rex: 60,
  hench: 60,
  sourcevision: 60,
  "llm-client": 20,
};
const DEFAULT_SUITE_SECONDS = 15;
/** Runner start-up, selection and the summary, per run. */
const RUN_OVERHEAD_SECONDS = 5;
/** `pnpm install` plus a full `pnpm build`, per worktree. */
const SETUP_SECONDS_PER_WORKTREE = 240;
/** Fixture commit plus the build of the packages it touches, per worktree and fixture. */
const FIXTURE_SECONDS_PER_WORKTREE = 60;
/** Pause between batches so one batch's tail does not load the next. */
export const COOLDOWN_MS = 15_000;
/** How much slower a capped run is assumed to be, for the estimate. */
const CAPPED_FACTOR = 1.3;
/** How much one of several uncapped parallel runs is assumed to slow down, for the estimate. */
const CONTENDED_FACTOR = 1.8;

export const USAGE = `Usage: node scripts/bench/validation-bench.mjs --out <dir> [options]

Replays the affected test gate under four settings on one commit.

  --out <dir>          where results go (required; outside the repository)
  --cases A,B,C,D      cases to run (default all)
                         A 1 worktree, NDX_TEST_MAX_WORKERS unset, no slot
                         B 1 worktree, NDX_TEST_MAX_WORKERS=${PILOT_MAX_WORKERS}, no slot
                         C N worktrees at once, unset, no slot
                         D N worktrees at once, NDX_TEST_MAX_WORKERS=${PILOT_MAX_WORKERS}, host slot
  --fixtures a,b       fixtures (default ${DEFAULT_FIXTURES.join(",")}; also ${Object.keys(FIXTURES).filter((f) => !DEFAULT_FIXTURES.includes(f)).join(", ")})
  --repeat N           repeats of the whole matrix (default 1)
  --concurrency N      worktrees for C and D (default 3)
  --timeout-min N      kill a run after N minutes (default 60)
  --dry-run            print the plan and an estimate; create nothing
  --keep               leave the bench worktrees for inspection
`;

function positiveInt(value, flag) {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new BenchUsageError(`${flag} must be a positive integer, got "${value}".`);
  return Number(value);
}

function listOf(value, known, flag) {
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = items.filter((i) => !known.includes(i));
  if (items.length === 0 || unknown.length > 0) {
    throw new BenchUsageError(`${flag}: unknown "${unknown.join('", "') || value}". Valid: ${known.join(", ")}.`);
  }
  return [...new Set(items)];
}

/** Whether `child` is `parent` or inside it. */
export function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Parse argv into options.
 * @param {string[]} argv
 * @param {{ repoRoots: string[], cwd?: string }} context repository directories `--out` must stay out of
 */
export function parseBenchArgs(argv, { repoRoots, cwd = process.cwd() }) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        out: { type: "string" },
        cases: { type: "string" },
        fixtures: { type: "string" },
        repeat: { type: "string" },
        concurrency: { type: "string" },
        "timeout-min": { type: "string" },
        "dry-run": { type: "boolean" },
        keep: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    throw new BenchUsageError(err.message);
  }
  if (values.help) return { help: true };
  if (!values.out) throw new BenchUsageError("--out <dir> is required.");
  const out = resolve(cwd, values.out);
  const inside = repoRoots.find((root) => isInside(out, root));
  if (inside) throw new BenchUsageError(`--out must be outside the repository (${inside}); got ${out}.`);
  return {
    help: false,
    out,
    cases: values.cases ? listOf(values.cases.toUpperCase(), Object.keys(CASES), "--cases") : Object.keys(CASES),
    fixtures: values.fixtures ? listOf(values.fixtures, Object.keys(FIXTURES), "--fixtures") : [...DEFAULT_FIXTURES],
    repeat: values.repeat ? positiveInt(values.repeat, "--repeat") : 1,
    concurrency: values.concurrency ? positiveInt(values.concurrency, "--concurrency") : 3,
    timeoutMs: (values["timeout-min"] ? positiveInt(values["timeout-min"], "--timeout-min") : 60) * 60_000,
    dryRun: Boolean(values["dry-run"]),
    keep: Boolean(values.keep),
  };
}

/** Worktrees a case uses. */
export function worktreesFor(caseId, concurrency) {
  return CASES[caseId].concurrent ? concurrency : 1;
}

/** The environment a case's runs get: NDX_TEST_MAX_WORKERS set or removed, no inherited slot token. */
export function caseEnv(caseId, base) {
  const env = { ...base };
  delete env.NDX_TEST_MAX_WORKERS;
  delete env.NDX_VALIDATION_SLOT;
  if (CASES[caseId].maxWorkers !== null) env.NDX_TEST_MAX_WORKERS = CASES[caseId].maxWorkers;
  return env;
}

/** The runner's arguments: cases without the slot opt out of the one the runner takes itself. */
export function runnerArgs(caseId, baseRef) {
  return ["scripts/run-all-tests.mjs", "affected", baseRef, ...(CASES[caseId].slot ? [] : ["--no-slot"])];
}

/** Estimated seconds for one batch of a case on a fixture. */
export function estimateBatchSeconds(caseId, fixtureSeconds, concurrency) {
  const c = CASES[caseId];
  const run = fixtureSeconds * (c.maxWorkers !== null ? CAPPED_FACTOR : 1);
  if (!c.concurrent) return run;
  // With the slot the runs go one after another; without it they share the machine.
  return c.slot ? run * concurrency : run * Math.max(1, concurrency * CONTENDED_FACTOR / 2);
}

/**
 * Build the plan: fixtures with their files and selected suites, the batches
 * in run order, and an estimate.
 *
 * @param {object} options parsed flags
 * @param {{ manifests: object[], fileExists: (relPath: string) => boolean }} env
 */
export function buildPlan(options, { manifests, fileExists }) {
  const fixtures = options.fixtures.map((name) => {
    const { files, note } = FIXTURES[name];
    const missing = files.filter((f) => !fileExists(f));
    if (missing.length > 0) {
      throw new BenchUsageError(`Fixture "${name}" names a file that does not exist: ${missing.join(", ")}. Update FIXTURES in scripts/bench/lib/plan.mjs.`);
    }
    const { suites, reasons } = selectAffected(files, manifests);
    const seconds = suites.length === 0
      ? RUN_OVERHEAD_SECONDS
      : RUN_OVERHEAD_SECONDS + suites.reduce((sum, s) => sum + (SUITE_ESTIMATE_SECONDS[s] ?? DEFAULT_SUITE_SECONDS), 0);
    return { name, note, files, suites, reasons, estimateSeconds: seconds };
  });

  const batches = [];
  for (let repeat = 1; repeat <= options.repeat; repeat++) {
    for (const fixture of fixtures) {
      for (const caseId of options.cases) {
        batches.push({
          caseId,
          fixture: fixture.name,
          repeat,
          worktrees: worktreesFor(caseId, options.concurrency),
          estimateSeconds: estimateBatchSeconds(caseId, fixture.estimateSeconds, options.concurrency),
        });
      }
    }
  }

  const worktrees = Math.max(...options.cases.map((c) => worktreesFor(c, options.concurrency)));
  const setupSeconds = worktrees * SETUP_SECONDS_PER_WORKTREE + options.repeat * fixtures.length * worktrees * FIXTURE_SECONDS_PER_WORKTREE;
  const runSeconds = batches.reduce((sum, b) => sum + b.estimateSeconds, 0) + batches.length * (COOLDOWN_MS / 1000);
  return {
    cases: options.cases.map((id) => ({ ...CASES[id], worktrees: worktreesFor(id, options.concurrency) })),
    fixtures,
    batches,
    worktrees,
    estimate: { setupSeconds, runSeconds, totalSeconds: setupSeconds + runSeconds },
  };
}

function minutes(seconds) {
  return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

/** The plan as the text `--dry-run` prints. */
export function formatPlan(plan, options) {
  const lines = [];
  lines.push(`Validation benchmark plan (${options.repeat} repeat${options.repeat === 1 ? "" : "s"}, results to ${options.out})`, "");
  lines.push("Cases:");
  for (const c of plan.cases) {
    const env = c.maxWorkers === null ? "NDX_TEST_MAX_WORKERS unset" : `NDX_TEST_MAX_WORKERS=${c.maxWorkers}`;
    lines.push(`  ${c.id}  ${c.worktrees} worktree${c.worktrees === 1 ? " " : "s"}  ${env.padEnd(26)}  ${(c.slot ? "host slot" : "no slot").padEnd(9)}  (${c.label})`);
  }
  lines.push("", "Fixtures (a comment appended to each file, committed on top of HEAD):");
  for (const f of plan.fixtures) {
    lines.push(`  ${f.name}: ${f.note}`);
    for (const file of f.files) lines.push(`    touches  ${file}`);
    lines.push(`    selects  ${f.suites.length > 0 ? f.suites.join(", ") : "(nothing)"}   ~${minutes(f.estimateSeconds)} solo`);
  }
  lines.push("", "Matrix (estimated batch time):");
  const header = ["case", ...plan.fixtures.map((f) => f.name)];
  lines.push(`  ${header.map((h, i) => (i === 0 ? h.padEnd(6) : h.padStart(12))).join("")}`);
  for (const c of plan.cases) {
    const cells = plan.fixtures.map((f) => {
      const b = plan.batches.find((x) => x.caseId === c.id && x.fixture === f.name);
      return minutes(b.estimateSeconds).padStart(12);
    });
    lines.push(`  ${c.id.padEnd(6)}${cells.join("")}`);
  }
  lines.push(
    "",
    `Batches: ${plan.batches.length}; bench worktrees: ${plan.worktrees}`,
    `Estimate (rough): setup ~${minutes(plan.estimate.setupSeconds)}, runs ~${minutes(plan.estimate.runSeconds)}, total ~${minutes(plan.estimate.totalSeconds)}`,
    "Dry run: nothing was created.",
  );
  return lines.join("\n");
}
