/**
 * Readiness scorecard: the judgement computed from the SDLC profile.
 *
 * Deliberately the second of two artifacts. `analyzers/sdlc-profile.ts` detects
 * what a repository has and records the file that proves each claim; this turns
 * that into a number. Keeping them apart means a weight change cannot alter
 * what was *observed*, and a detector improvement cannot quietly move a score
 * without the evidence to go with it.
 *
 * ## The same shape as PRD health, on purpose
 *
 * `packages/rex/src/core/health.ts` scores weighted dimensions 0-100, takes the
 * overall as the weighted sum, and aims its suggestions at the weakest
 * dimension. This copies that so the dashboard can render PRD health and repo
 * readiness with one component rather than two that drift.
 *
 * ## Heuristic, and labelled as such wherever it is published
 *
 * This says whether tests exist, run, and where the holes are — not whether
 * they are good. Reading infrastructure files is configuration review, not a
 * pentest or a CVE scan. Every consumer must carry that caveat.
 *
 * ## Gaps are the useful output
 *
 * A score is a summary; a gap is actionable. Every gap names the evidence that
 * would raise the score, so the output reads as a next step rather than a
 * complaint. `ReadinessGap.wouldRaiseScore` is a required field, so a gap that
 * only complains does not compile.
 *
 * @module sourcevision/analyzers/readiness-score
 */

import {
  assessRepoExecutionConfig,
  collectRepoExecutionConfig,
  type RepoTrustFinding,
} from "@n-dx/llm-client";

import type { SdlcDetection, SdlcEvidence, SdlcProfile } from "../schema/v1.js";

// ── Weights ─────────────────────────────────────────────────────────────────

/**
 * The weight each dimension carries in the overall score.
 *
 * **The single source of truth.** Nothing — not a call site, not a test, not a
 * docs table — restates these numbers as literals. A test asserts they sum to
 * 1.0, and the declaration order here is the order the scorecard reports and
 * the tie-break between equally weak dimensions, so it is deliberate rather
 * than incidental: the earlier a dimension sits, the sooner it is suggested
 * when several are equally bad.
 *
 * These are starting weights. Changing one is a product decision, and the
 * fixtures assert exact scores precisely so that it cannot be done by accident.
 */
export const READINESS_WEIGHTS = {
  testing: 0.20,
  ci: 0.15,
  cd: 0.15,
  rollback: 0.10,
  migrations: 0.10,
  featureFlags: 0.05,
  qualityGates: 0.10,
  observability: 0.05,
  agentSafety: 0.10,
} as const;

/** The nine scored dimensions, named by the weights constant. */
export type ReadinessDimensionName = keyof typeof READINESS_WEIGHTS;

/**
 * Report order, and the tie-break when two dimensions score the same.
 *
 * Derived from the weights constant rather than written out again, so a
 * dimension cannot exist in one list and be missing from the other.
 */
export const READINESS_DIMENSIONS: readonly ReadinessDimensionName[] =
  Object.keys(READINESS_WEIGHTS) as ReadinessDimensionName[];

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Something missing, and what would fix it.
 *
 * `wouldRaiseScore` is required: a gap that cannot say what evidence would
 * raise the score is a complaint, and this output is meant to be worked from.
 */
export interface ReadinessGap {
  /** What is absent or unproven, in one line. */
  summary: string;
  /** The concrete evidence that would raise this dimension's score. */
  wouldRaiseScore: string;
}

/** One dimension's verdict, with the proof behind it. */
export interface ReadinessDimensionScore {
  /** 0-100. */
  score: number;
  /** This dimension's share of `overall`, from {@link READINESS_WEIGHTS}. */
  weight: number;
  /**
   * The evidence behind the score, taken from the profile's own detections.
   *
   * Carried through rather than recomputed: the scorer never re-reads a file,
   * so a score can always be traced back to the artifact the analyzer saw.
   */
  evidence: SdlcEvidence[];
  /** What is missing, each with the evidence that would fix it. */
  gaps: ReadinessGap[];
}

/**
 * How ready this repository is to be worked by an autonomous agent.
 *
 * Mirrors `StructureHealthScore` in rex: an overall 0-100, per-dimension
 * detail, and suggestions aimed at the weakest dimensions.
 */
export interface ReadinessScore {
  /** Weighted sum of the dimension scores, rounded. 0-100. */
  overall: number;
  dimensions: Record<ReadinessDimensionName, ReadinessDimensionScore>;
  /** Top improvement suggestions, worst dimension first. At most three. */
  suggestions: string[];
}

/**
 * The agent-safety input, read from `@n-dx/llm-client`'s repo-trust module.
 *
 * Passed in rather than collected inside the scorer so that scoring stays a
 * pure function of its inputs — the fixtures assert exact scores, which a
 * function that read the user's per-user trust store could not support.
 */
export interface AgentSafetyInput {
  /** Config files that were read, project-relative. The evidence for this dimension. */
  sources: string[];
  /** What repo-trust found wider than the baseline for this repository. */
  findings: RepoTrustFinding[];
}

export interface ReadinessOptions {
  /**
   * Override the agent-safety input. Defaults to collecting it from
   * `profile.projectDir`; when the profile has no `projectDir` — it is stripped
   * before the profile is written to disk — there is nothing to read and the
   * dimension scores zero with a gap saying so.
   */
  agentSafety?: AgentSafetyInput;
}

// ── Scoring primitives ──────────────────────────────────────────────────────

/**
 * One thing a dimension is scored on.
 *
 * Declaring the points beside the gap keeps the two in step: a criterion that
 * awards points necessarily carries the gap shown when it does not.
 */
interface Criterion {
  points: number;
  met: boolean;
  gap: ReadinessGap;
}

/** A dimension's result before the no-evidence rule is applied. */
interface Scored {
  evidence: SdlcEvidence[];
  score: number;
  gaps: ReadinessGap[];
  /** Replaces `gaps` when nothing at all was detected. */
  noEvidence: ReadinessGap;
}

/** Sum the criteria that are met; the rest become the gaps. */
function fromCriteria(
  evidence: SdlcEvidence[],
  noEvidence: ReadinessGap,
  criteria: Criterion[],
): Scored {
  let score = 0;
  const gaps: ReadinessGap[] = [];
  for (const criterion of criteria) {
    if (criterion.met) score += criterion.points;
    else gaps.push(criterion.gap);
  }
  return { evidence, score, gaps, noEvidence };
}

/**
 * Apply the no-evidence rule and attach the weight.
 *
 * No evidence means a score of zero and a single gap naming what is missing,
 * rather than a list of every unmet criterion: when the analyzer found nothing
 * in a section, "there is nothing here" is the whole story and repeating it
 * five ways buries it.
 */
function resolve(name: ReadinessDimensionName, scored: Scored): ReadinessDimensionScore {
  const weight = READINESS_WEIGHTS[name];
  if (scored.evidence.length === 0) {
    return { score: 0, weight, evidence: [], gaps: [scored.noEvidence] };
  }
  return { score: scored.score, weight, evidence: scored.evidence, gaps: scored.gaps };
}

/** Flatten detections into the evidence they carry. */
function evidenceOf(...groups: readonly SdlcDetection[][]): SdlcEvidence[] {
  const out: SdlcEvidence[] = [];
  for (const group of groups) {
    for (const detection of group) out.push(...detection.evidence);
  }
  return out;
}

function distinct<T, K>(items: readonly T[], key: (item: T) => K): number {
  return new Set(items.map(key)).size;
}

// ── Dimension scorers ───────────────────────────────────────────────────────

/**
 * Testing: is there a way to run tests, and do tests exist at more than one level?
 *
 * A declared test command and a test file are separate facts, and a repository
 * can have either without the other — a Go module always offers `go test ./...`
 * whether or not anybody wrote a test. Both are scored, so the gaps can say
 * which half is missing.
 */
function scoreTesting(profile: SdlcProfile): Scored {
  const commands = profile.commands.filter((c) => c.kind === "test");
  const { frameworks, suites, coverage } = profile.tests;

  return fromCriteria(
    evidenceOf(commands, frameworks, suites, coverage ? [coverage] : []),
    {
      summary: "No test command, framework or test file was detected.",
      wouldRaiseScore:
        "A `test` script in a manifest, a test framework dependency, or any file matching the project's test naming convention.",
    },
    [
      {
        points: 30,
        met: commands.length > 0,
        gap: {
          summary: "No test command is declared.",
          wouldRaiseScore:
            "A `test` script in package.json, a `test` target in a Makefile, or a `[tool.*.scripts]` test entry.",
        },
      },
      {
        points: 20,
        met: frameworks.length > 0,
        gap: {
          summary: "No test framework was detected.",
          wouldRaiseScore:
            "A dependency on a recognised test runner — vitest, jest, pytest, playwright, cypress — in a manifest.",
        },
      },
      {
        points: 20,
        met: suites.some((s) => s.kind === "unit"),
        gap: {
          summary: "No unit tests were found.",
          wouldRaiseScore:
            "Test files under a `tests/`, `test/`, `spec/` or `__tests__/` directory, or named `*.test.*`.",
        },
      },
      {
        points: 20,
        met: suites.some((s) => s.kind !== "unit"),
        gap: {
          summary: "Unit tests are the only kind found; nothing exercises the system end to end.",
          wouldRaiseScore:
            "Tests under an `integration/`, `e2e/`, `contract/` or `smoke/` directory, which prove the pieces work together.",
        },
      },
      {
        points: 10,
        met: coverage !== undefined,
        gap: {
          summary: "Coverage is not measured.",
          wouldRaiseScore:
            "A coverage tool configured in a manifest or a CI step, ideally with a threshold that fails the build.",
        },
      },
    ],
  );
}

/** CI: does a pipeline exist, does it run the tests, and does it start by itself? */
function scoreCi(profile: SdlcProfile): Scored {
  const { ci } = profile;
  const steps = ci.flatMap((p) => p.jobs.flatMap((j) => j.steps));

  return fromCriteria(
    evidenceOf(ci),
    {
      summary: "No CI pipeline was detected.",
      wouldRaiseScore:
        "A workflow file for a supported provider — GitHub Actions, GitLab CI, CircleCI, Bitbucket Pipelines or a Jenkinsfile.",
    },
    [
      {
        points: 40,
        met: ci.length > 0,
        gap: {
          summary: "No CI pipeline was detected.",
          wouldRaiseScore: "A workflow file for a supported CI provider.",
        },
      },
      {
        points: 30,
        met: steps.some((s) => s.kind === "test"),
        gap: {
          summary: "No CI job runs the tests, so nothing stops a broken change merging.",
          wouldRaiseScore: "A step in a pipeline whose command runs the test suite.",
        },
      },
      {
        points: 20,
        met: ci.some((p) => p.triggers.length > 0),
        gap: {
          summary: "No pipeline declares a trigger, so CI may only run when started by hand.",
          wouldRaiseScore: "A `push` or `pull_request` trigger on a pipeline.",
        },
      },
      {
        points: 10,
        met: steps.some((s) => s.kind === "lint" || s.kind === "typecheck"),
        gap: {
          summary: "CI does not lint or type-check.",
          wouldRaiseScore: "A lint or type-check step in a pipeline.",
        },
      },
    ],
  );
}

/** CD: can a change reach an environment without a human driving it? */
function scoreCd(profile: SdlcProfile): Scored {
  const { cd } = profile;

  return fromCriteria(
    evidenceOf(cd),
    {
      summary: "No deployment path was detected.",
      wouldRaiseScore:
        "A CI job with a deploy step — `kubectl apply`, `helm upgrade`, `terraform apply`, or a deploy script.",
    },
    [
      {
        points: 50,
        met: cd.length > 0,
        gap: {
          summary: "No deployment path was detected.",
          wouldRaiseScore: "A CI job with a deploy step.",
        },
      },
      {
        points: 30,
        met: cd.some((d) => d.automated),
        gap: {
          summary: "Every deployment found has to be started by hand.",
          wouldRaiseScore:
            "A trigger on the pipeline that owns the deploy job, so a merge deploys without a human.",
        },
      },
      {
        points: 20,
        met: distinct(cd, (d) => d.environment) >= 2,
        gap: {
          summary: "Only one environment is deployed to, so changes reach production unrehearsed.",
          wouldRaiseScore: "A second deploy job for a staging or preview environment ahead of production.",
        },
      },
    ],
  );
}

/**
 * Rollback: can a bad deploy be undone?
 *
 * The analyzer does not yet populate `profile.rollback`, so this reports zero
 * on every repository today. That is the honest reading of an empty section —
 * the gap says what evidence would move it — and scoring the dimension now
 * means teaching the detector to fill that section needs no change here.
 */
function scoreRollback(profile: SdlcProfile): Scored {
  const { rollback } = profile;

  return fromCriteria(
    evidenceOf(rollback),
    {
      summary: "No way to undo a deployment was detected.",
      wouldRaiseScore:
        "A rollback job that redeploys the previous version, a blue-green or canary deployment, or a documented down-migration path.",
    },
    [
      {
        points: 60,
        met: rollback.length > 0,
        gap: {
          summary: "No rollback mechanism was detected.",
          wouldRaiseScore: "A job or script that restores the previous release.",
        },
      },
      {
        points: 40,
        met: rollback.some((r) => r.mechanism !== "manual"),
        gap: {
          summary: "Rollback is manual, so recovery time depends on who is awake.",
          wouldRaiseScore:
            "An automated rollback — a redeploy-previous job, a blue-green swap, or a feature-flag kill switch.",
        },
      },
    ],
  );
}

/** Migrations: is schema change version-controlled, with a known tool, and run by the deploy? */
function scoreMigrations(profile: SdlcProfile): Scored {
  const { migrations } = profile;

  return fromCriteria(
    evidenceOf(migrations),
    {
      summary: "No data migrations were detected.",
      wouldRaiseScore:
        "A migrations directory for a recognised tool — Prisma, Alembic, Rails, Flyway. A repository with no database legitimately scores zero here.",
    },
    [
      {
        points: 50,
        met: migrations.length > 0,
        gap: {
          summary: "No migrations directory was found.",
          wouldRaiseScore:
            "Version-controlled migration files rather than schema changes applied by hand.",
        },
      },
      {
        points: 25,
        met: migrations.some((m) => m.tool !== "unknown"),
        gap: {
          summary: "A migrations directory was found but the tool that runs it could not be identified.",
          wouldRaiseScore: "A recognised migration tool's own layout or config file beside the directory.",
        },
      },
      {
        points: 25,
        met: migrations.some((m) => m.automated === true || m.reversible === true),
        gap: {
          summary: "Migrations are neither known to run during deploy nor known to be reversible.",
          wouldRaiseScore: "A migrate step in the deploy pipeline, or a down migration beside each forward one.",
        },
      },
    ],
  );
}

/** Feature flags: can a change ship dark and be turned off without a deploy? */
function scoreFeatureFlags(profile: SdlcProfile): Scored {
  const { featureFlags } = profile;

  return fromCriteria(
    evidenceOf(featureFlags),
    {
      summary: "No feature-flag system was detected.",
      wouldRaiseScore:
        "A dependency on a flag provider — LaunchDarkly, Unleash, Split, Flagsmith — or an in-house toggle module, so a change can ship dark.",
    },
    [
      {
        points: 70,
        met: featureFlags.length > 0,
        gap: {
          summary: "No feature-flag provider was detected.",
          wouldRaiseScore: "A flag provider dependency in a manifest.",
        },
      },
      {
        points: 30,
        met: featureFlags.some((f) => (f.flags?.length ?? 0) > 0),
        gap: {
          summary: "A flag provider is configured but no flag keys were readable from the code.",
          wouldRaiseScore:
            "Flag keys declared as string constants rather than built at runtime, so they can be inventoried.",
        },
      },
    ],
  );
}

/** Quality gates: what can actually block a bad change before it merges? */
function scoreQualityGates(profile: SdlcProfile): Scored {
  const { qualityGates } = profile;

  return fromCriteria(
    evidenceOf(qualityGates),
    {
      summary: "No merge-blocking gate was detected.",
      wouldRaiseScore:
        "A CODEOWNERS file, a pre-commit hook config, or branch protection requiring review and status checks. Branch protection is only visible through the host's API, which this analysis does not call.",
    },
    [
      {
        points: 40,
        met: qualityGates.length > 0,
        gap: {
          summary: "No quality gate was detected.",
          wouldRaiseScore: "A CODEOWNERS file or a pre-commit hook configuration.",
        },
      },
      {
        points: 40,
        met: qualityGates.some((g) => g.blocking),
        gap: {
          summary: "Every gate found only advises; none blocks a merge.",
          wouldRaiseScore:
            "A required status check or a pre-commit hook that fails the change rather than warning about it.",
        },
      },
      {
        points: 20,
        met: distinct(qualityGates, (g) => g.kind) >= 2,
        gap: {
          summary: "Only one kind of gate is in place, so a single misconfiguration removes all review.",
          wouldRaiseScore:
            "A second, different gate — review ownership and an automated check guard different failures.",
        },
      },
    ],
  );
}

/** Observability: if a deploy breaks something, would anyone find out? */
function scoreObservability(profile: SdlcProfile): Scored {
  const { observability } = profile;

  return fromCriteria(
    evidenceOf(observability),
    {
      summary: "No instrumentation was detected, so a failed change would be invisible.",
      wouldRaiseScore:
        "A logging, metrics, tracing or error-reporting dependency — OpenTelemetry, Sentry, Prometheus, pino — in a manifest.",
    },
    [
      {
        points: 40,
        met: observability.length > 0,
        gap: {
          summary: "No instrumentation was detected.",
          wouldRaiseScore: "A logging, metrics, tracing or error-reporting dependency.",
        },
      },
      {
        points: 30,
        met: distinct(observability, (o) => o.kind) >= 2,
        gap: {
          summary: "Only one kind of signal is collected.",
          wouldRaiseScore:
            "A second signal kind — logs say what happened, metrics say how often, traces say where.",
        },
      },
      {
        points: 30,
        met: observability.some((o) => o.kind === "tracing" || o.kind === "error-reporting"),
        gap: {
          summary: "Nothing reports errors or traces requests, so a failure has to be found by reading logs.",
          wouldRaiseScore:
            "An error reporter such as Sentry, or a tracer such as OpenTelemetry, which surface a regression without being asked.",
        },
      },
    ],
  );
}

/** What each repo-trust severity costs the agent-safety score. */
const AGENT_SAFETY_PENALTY: Record<RepoTrustFinding["severity"], number> = {
  warning: 25,
  info: 5,
};

/**
 * Agent safety: is it safe to let an autonomous agent run here?
 *
 * The one subtractive dimension, and the one not read from the profile.
 * `@n-dx/llm-client`'s `repo-trust` already judges this and is neither moved
 * nor modified: its `sources` become the evidence and its `findings` become the
 * gaps, each finding costing points by severity.
 *
 * A repository that ships no execution config left hench's defaults in force,
 * which is the safe case — but it also offers no evidence that anybody reviewed
 * the checkout, and this scorecard does not award points for an absence. It
 * scores zero with a gap saying exactly that.
 */
function scoreAgentSafety(input: AgentSafetyInput): Scored {
  const evidence: SdlcEvidence[] = input.sources.map((path) => ({
    kind: "agent-config",
    path,
    confidence: "certain",
  }));

  const penalty = input.findings.reduce(
    (sum, finding) => sum + AGENT_SAFETY_PENALTY[finding.severity],
    0,
  );

  const gaps: ReadinessGap[] = input.findings.map((finding) => ({
    summary: finding.message,
    wouldRaiseScore:
      finding.severity === "warning"
        ? "Narrow the setting back to the baseline for the repository's language, or record a review with `n-dx trust accept` so the widening is deliberate."
        : "Bring the setting in line with the current defaults, or record a review with `n-dx trust accept`.",
  }));

  return {
    evidence,
    score: Math.max(0, 100 - penalty),
    gaps,
    noEvidence: {
      summary: "No agent execution config was found, so nothing records that the checkout was reviewed.",
      wouldRaiseScore:
        "An explicit guard in the project's hench config — `n-dx config` writes one — which both narrows what an agent may run and gives `n-dx trust` something to review.",
    },
  };
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Read the agent-safety input for a project.
 *
 * A thin pass-through to `repo-trust`, which is neither moved nor modified:
 * `sources` becomes this dimension's evidence and `findings` becomes its gaps.
 */
export function collectAgentSafety(projectDir: string): AgentSafetyInput {
  const config = collectRepoExecutionConfig(projectDir);
  return { sources: config.sources, findings: assessRepoExecutionConfig(config) };
}

/**
 * Compute the readiness score for a detected SDLC profile.
 *
 * Pure apart from the default agent-safety collection, which reads the
 * project's own config files. Pass `options.agentSafety` to score a profile
 * without touching the filesystem.
 */
export function computeReadinessScore(
  profile: SdlcProfile,
  options: ReadinessOptions = {},
): ReadinessScore {
  const agentSafety =
    options.agentSafety ??
    (profile.projectDir === undefined
      ? { sources: [], findings: [] }
      : collectAgentSafety(profile.projectDir));

  const scored: Record<ReadinessDimensionName, Scored> = {
    testing: scoreTesting(profile),
    ci: scoreCi(profile),
    cd: scoreCd(profile),
    rollback: scoreRollback(profile),
    migrations: scoreMigrations(profile),
    featureFlags: scoreFeatureFlags(profile),
    qualityGates: scoreQualityGates(profile),
    observability: scoreObservability(profile),
    agentSafety: scoreAgentSafety(agentSafety),
  };

  const dimensions = {} as Record<ReadinessDimensionName, ReadinessDimensionScore>;
  let overall = 0;
  for (const name of READINESS_DIMENSIONS) {
    const resolved = resolve(name, scored[name]);
    dimensions[name] = resolved;
    overall += resolved.score * resolved.weight;
  }

  return { overall: Math.round(overall), dimensions, suggestions: suggest(dimensions) };
}

// ── Suggestions ─────────────────────────────────────────────────────────────

/** Display names, in report order. */
export const DIMENSION_LABELS: Record<ReadinessDimensionName, string> = {
  testing: "Testing",
  ci: "CI",
  cd: "CD",
  rollback: "Rollback",
  migrations: "Migrations",
  featureFlags: "Feature flags",
  qualityGates: "Quality gates",
  observability: "Observability",
  agentSafety: "Agent safety",
};

/**
 * Aim the suggestions at the weakest dimensions, as rex health does.
 *
 * Ordered by score ascending, then by weight descending, then by the order in
 * {@link READINESS_WEIGHTS}. The weight tie-break is what makes the advice
 * useful on a bare repository, where everything scores zero: fixing the
 * heaviest dimension first moves the overall score most.
 */
function suggest(dimensions: Record<ReadinessDimensionName, ReadinessDimensionScore>): string[] {
  const candidates = READINESS_DIMENSIONS.filter((name) => dimensions[name].gaps.length > 0);

  candidates.sort((a, b) => {
    const byScore = dimensions[a].score - dimensions[b].score;
    if (byScore !== 0) return byScore;
    const byWeight = dimensions[b].weight - dimensions[a].weight;
    if (byWeight !== 0) return byWeight;
    return READINESS_DIMENSIONS.indexOf(a) - READINESS_DIMENSIONS.indexOf(b);
  });

  return candidates.slice(0, 3).map((name) => {
    const gap = dimensions[name].gaps[0];
    return `${DIMENSION_LABELS[name]}: ${gap.summary} ${gap.wouldRaiseScore}`;
  });
}
