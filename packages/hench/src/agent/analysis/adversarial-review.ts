/**
 * Adversarial review pass — prompt construction and report parsing.
 *
 * This module is the *pure* half of `ndx work --review`: it builds the prompt
 * the reviewer receives and parses the structured report the reviewer writes
 * back. It spawns nothing and touches no git state, which is what makes it
 * testable without a live vendor CLI. The spawn itself lives in
 * `lifecycle/cli-loop.ts`, which already owns process management, streaming,
 * and token accounting.
 *
 * ## What the pass is
 *
 * After a task's changes validate, a second agent attacks them: it runs the
 * `ndx-adversarial-review` skill against the scope this task actually touched,
 * triages each finding for severity and necessity, fixes what must be fixed,
 * and captures the rest to the PRD. It runs *before* the commit prompt so the
 * fixes land in the same commit as the work they repair.
 *
 * ## Why the reviewer resumes the work session
 *
 * For the Claude CLI the reviewer re-enters the session that just did the work
 * (`--resume <session-id>`), on a stronger model. That inherits everything the
 * diff cannot show: which approaches were tried and abandoned, which files
 * were read and found irrelevant, what the implementer believed it was doing.
 * A reviewer reading only the diff has to reconstruct all of that, badly.
 *
 * The obvious objection is anchoring — a resumed reviewer might defend the
 * work rather than attack it. That is why {@link buildReviewSystemPrompt}
 * spends most of its length insisting on the opposite posture, and why the
 * report format forces a concrete failure trigger for every finding: a claim
 * you must construct inputs for is much harder to hand-wave than a rating.
 *
 * ## Report transport
 *
 * The reviewer writes JSON to a file rather than printing it. Stdout is a
 * stream shared with the model's prose, tool output, and vendor chatter;
 * fishing a JSON object out of it means guessing where the object starts. A
 * file has one writer, one reader, and an unambiguous "absent" state.
 *
 * A missing or malformed report is **not** a task failure. The task's own
 * validation already passed; a broken review is a broken review, and the
 * caller reports it as such rather than reverting completed work.
 *
 * @module hench/agent/analysis/adversarial-review
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ── Report shape ─────────────────────────────────────────────────────────

/** Severity scale — mirrors the four levels in the `ndx-adversarial-review` skill. */
export const REVIEW_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

/** Necessity verdict from the skill's second pass. */
export const REVIEW_VERDICTS = [
  "must-fix",
  "should-fix",
  "not-worth-fixing",
  "out-of-scope",
] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** What the review pass actually did about a finding. */
export const REVIEW_ACTIONS = ["fixed", "captured", "dropped", "failed"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** One triaged finding. */
export interface ReviewFinding {
  /** The defect, stated as a defect — not as an activity. */
  title: string;
  /** `path/to/file.ts:123`, or just the path when no single line applies. */
  location?: string;
  severity: ReviewSeverity;
  verdict: ReviewVerdict;
  /** Concrete inputs or state → wrong output, crash, or corruption. */
  scenario: string;
  /** What the pass did about it. */
  action: ReviewAction;
  /** Rex item id, when the finding was captured to the PRD. */
  itemId?: string;
  /** Free-text note — why it was dropped, what the fix changed, why capture failed. */
  note?: string;
}

/** The full report a review pass writes. */
export interface ReviewReport {
  /** Task the review was scoped to. */
  taskId: string;
  /** Findings after both passes. Empty means the attack found nothing. */
  findings: ReviewFinding[];
  /** Whether the reviewer edited files. Drives the re-validation decision. */
  fixesApplied: boolean;
  /** One-paragraph account of what was attacked, including what was *not*. */
  summary: string;
}

/** Why a review pass produced no usable report. */
export type ReviewFailureReason =
  | "no-report"
  | "malformed-report"
  | "spawn-failed"
  | "unsupported-vendor";

/** Outcome of a review pass, from the caller's point of view. */
export type ReviewPassOutcome =
  | { ok: true; report: ReviewReport }
  | { ok: false; reason: ReviewFailureReason; detail: string };

// ── Report location ──────────────────────────────────────────────────────

/** Directory under `.hench/` holding review reports, one file per run. */
export const REVIEW_REPORT_SUBDIR = "reviews";

/**
 * Absolute path of the report file for a given run.
 *
 * Keyed by run id rather than task id so a task reviewed twice (a retry, a
 * re-run after a fix) keeps both reports instead of silently overwriting the
 * first — the earlier report is the evidence for what the later one changed.
 */
export function reviewReportPath(henchDir: string, runId: string): string {
  return join(henchDir, REVIEW_REPORT_SUBDIR, `${runId}.json`);
}

// ── Prompt construction ──────────────────────────────────────────────────

/** Everything the prompt builders need to describe the review's scope. */
export interface ReviewPromptContext {
  /** Task the completed work belongs to. */
  taskId: string;
  /** Task title, for a human-readable scope line. */
  taskTitle: string;
  /**
   * Commit the working tree sat at before the agent ran, when it could be
   * captured. This is what bounds the review to *this task's* change instead
   * of the whole branch.
   */
  startingHead?: string;
  /** Absolute path the reviewer must write its JSON report to. */
  reportPath: string;
  /**
   * True when the reviewer is resuming the session that did the work. Changes
   * the brief substantially: a resumed reviewer already holds the context, so
   * the brief spends its length on posture rather than re-explaining the task.
   */
  resumed: boolean;
  /**
   * True when the run cannot ask the user anything — `--auto`, `--loop`,
   * `--yes`, or no TTY. Autonomous runs use the verdict-driven policy below;
   * interactive runs still stop and ask before capturing to the PRD.
   */
  autonomous: boolean;
}

/**
 * The reviewer's system prompt.
 *
 * Deliberately short. The `ndx-adversarial-review` skill already carries the
 * method — two passes, severity scale, necessity verdicts, the requirement to
 * construct a trigger and then try to refute it. Restating that here would
 * create a second copy to drift out of sync with the first. What the system
 * prompt adds is the two things the skill cannot know: that this is a machine
 * -driven run whose output is parsed, and that the reviewer must not defend
 * work it may have just written.
 */
export function buildReviewSystemPrompt(): string {
  return [
    "You are running an adversarial review pass inside an automated `ndx work` run.",
    "",
    "Your job is to find what breaks. You are not summarizing the change, not",
    "confirming it looks reasonable, and not congratulating the implementer.",
    "",
    "If this conversation already contains the work under review, that work is",
    "now EVIDENCE, not something to defend. Your earlier reasoning about why an",
    "approach was correct is exactly the reasoning most likely to be wrong —",
    "attack it first and hardest. Treat every completion claim, checked-off",
    "acceptance criterion, and confident comment in the diff as an assertion",
    "under test.",
    "",
    "Two rules keep this pass honest:",
    "",
    "1. Every finding needs a concrete failure trigger — specific inputs or",
    "   state, and the specific wrong output, crash, or corruption that",
    "   results. If you cannot construct one, the finding does not exist. Drop",
    "   it; do not soften it into a 'consider' or a 'might want to'.",
    "2. Before writing a finding down, go looking for the guard, caller-side",
    "   check, or type that makes your scenario impossible. If you find it,",
    "   drop the finding.",
    "",
    "A pass that reports zero findings and says precisely what it attacked is a",
    "good outcome. A pass that pads the list to look thorough is a failure —",
    "invented findings cost a human triage cycle each and teach the team to",
    "ignore the next report.",
  ].join("\n");
}

/**
 * The reviewer's task brief.
 *
 * Two shapes, chosen by {@link ReviewPromptContext#resumed}. The resumed brief
 * assumes the conversation already holds the task, the plan, and the files;
 * the fresh brief has to establish all of it from git and rex.
 */
export function buildReviewBrief(ctx: ReviewPromptContext): string {
  const lines: string[] = [];

  lines.push("# Adversarial review pass");
  lines.push("");

  if (ctx.resumed) {
    lines.push(
      "The task you were just working on has passed completion validation and is",
      "about to be committed. Before that happens, review it adversarially.",
      "",
    );
  } else {
    lines.push(
      `A task was just completed by another agent and is about to be committed.`,
      `Review it adversarially. You do not have that agent's context, so build`,
      `your own from the code and the PRD before you attack anything.`,
      "",
      `Task: ${ctx.taskId} — ${ctx.taskTitle}`,
      `Fetch its acceptance criteria and parent chain with \`get_item\` (rex MCP).`,
      "",
    );
  }

  lines.push("## Scope");
  lines.push("");
  if (ctx.startingHead) {
    lines.push(
      `Review the change this task made, and nothing else. That change is:`,
      "",
      "```sh",
      `git diff ${ctx.startingHead}..HEAD    # committed during the run`,
      `git status --porcelain               # plus anything still uncommitted`,
      `git diff                             # working-tree changes`,
      "```",
      "",
      `Do NOT review the whole branch. Anything outside \`${ctx.startingHead}..HEAD\``,
      "plus the working tree is pre-existing code — if you find a real defect there,",
      "it is `out-of-scope`, reported separately, never folded into this change.",
    );
  } else {
    lines.push(
      "The pre-run commit could not be captured, so scope the review to the",
      "working tree: `git status --porcelain`, `git diff`, `git diff --cached`,",
      "and the contents of any untracked files. Say in your summary that the",
      "review was bounded this way — it may miss changes the run already",
      "committed.",
    );
  }
  lines.push("");

  lines.push("## Method");
  lines.push("");
  lines.push(
    "Run the `/ndx-adversarial-review` skill and follow its method: build ground",
    "truth from the code and the project's own checks, attack (Pass 1), then",
    "decide necessity (Pass 2). Its severity scale and verdict set are the ones",
    "this report uses.",
    "",
    "Two deviations from the skill's default flow, because this run is automated:",
    "",
  );

  if (ctx.autonomous) {
    lines.push(
      "- **Do not stop to ask.** The skill's Step 5 waits for a human to approve",
      "  what gets captured. There is no human attached to this run. Apply the",
      "  policy below instead.",
    );
  } else {
    lines.push(
      "- **Ask before capturing, as the skill says.** A human is attached to this",
      "  run. Present findings and wait for an explicit selection before writing",
      "  any PRD item.",
    );
  }
  lines.push(
    "- **Write the machine-readable report** described under Output below. This",
    "  is in addition to whatever you print for the human, not instead of it.",
    "",
  );

  lines.push("## What to do with each finding");
  lines.push("");
  lines.push(
    "| Verdict | Action | Record as |",
    "|---|---|---|",
    "| `must-fix` | Fix it now, in this session. Add or update the test that would have caught it. Re-run the project's checks after the fix. | `fixed` |",
    ctx.autonomous
      ? "| `should-fix` | Capture as a PRD task with `add_item` (rex MCP). Do not fix it here. | `captured` |"
      : "| `should-fix` | Offer to capture; capture only what the user selects. | `captured`, else `dropped` |",
    ctx.autonomous
      ? "| `out-of-scope` | Capture under the area it actually belongs to, never under this change. | `captured` |"
      : "| `out-of-scope` | Offer to capture under its own area; capture only what the user selects. | `captured`, else `dropped` |",
    "| `not-worth-fixing` | Nothing. Report it with the reason — unreachable, already covered, or fix costs more than the defect. | `dropped` |",
    "",
    "Before creating any PRD item, check whether one already tracks the same",
    "defect: list the directories under `.rex/prd_tree/` and read the `index.md`",
    "of any whose slug is plausibly related. Match on the defect, not the",
    "wording. If it is already tracked, record the finding as `captured` with the",
    "existing item's id and say so in `note` — do not create a duplicate.",
    "",
    "When you create an item, follow the skill's field mapping: `priority` gets",
    "the severity verbatim, `acceptanceCriteria` gets one entry per criterion",
    "(each written to fail today and pass once fixed), `tags` gets",
    "`ndx-adversarial-review` and `severity:<level>`, and `source` gets",
    "`ndx-adversarial-review`.",
    "",
  );

  lines.push("## Boundaries");
  lines.push("");
  lines.push(
    "- **Fix `must-fix` only.** Do not opportunistically refactor, reformat, or",
    "  clean up code you happen to dislike. Every line you touch beyond a",
    "  must-fix widens the diff a human has to review and dilutes the signal",
    "  that this pass exists to produce.",
    "- **Do not commit.** The run commits after you finish; your fixes are picked",
    "  up by that commit. Do not run `git commit`, `git reset`, `git checkout`,",
    "  `git clean`, or anything else that rewrites history or discards work.",
    "- **Do not change the task's status.** The run owns that transition.",
    "- **Read-only project checks only.** Tests, typecheck, and lint are fine.",
    "  Never run `ndx ci`, `ndx plan`, `ndx analyze`, `ndx refresh`, formatters",
    "  in write mode, codegen, migrations, or snapshot updates (`-u`) — they",
    "  rewrite state this run is concurrently writing.",
    "- **If a fix does not work, stop and report it.** Record the finding as",
    "  `failed` with what you tried. A half-applied fix is worse than none.",
    "",
  );

  lines.push("## Output");
  lines.push("");
  lines.push(
    `Write your report as JSON to this exact path:`,
    "",
    `    ${ctx.reportPath}`,
    "",
    "Create the parent directory if it does not exist. The schema:",
    "",
    "```json",
    "{",
    `  "taskId": ${JSON.stringify(ctx.taskId)},`,
    '  "fixesApplied": true,',
    '  "summary": "One paragraph: what you attacked, and what you did NOT reach.",',
    '  "findings": [',
    "    {",
    '      "title": "Defect stated as a defect, not as an activity",',
    '      "location": "packages/foo/src/bar.ts:42",',
    '      "severity": "critical | high | medium | low",',
    '      "verdict": "must-fix | should-fix | not-worth-fixing | out-of-scope",',
    '      "scenario": "Concrete inputs or state -> the wrong result that follows",',
    '      "action": "fixed | captured | dropped | failed",',
    '      "itemId": "rex item id, when captured",',
    '      "note": "Why dropped / what the fix changed / why capture failed"',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "`findings` must account for every finding that survived Pass 1, including",
    "the ones you dropped — a finding that vanishes without a verdict and an",
    "action is a review hiding its own result. An empty array is a valid and",
    "useful report when the attack genuinely found nothing; say what you",
    "attacked in `summary` so the next reader can judge whether it was aimed",
    "correctly.",
    "",
    "Set `fixesApplied` to true only if you actually edited a file.",
    "",
    "Write the file last, after every fix and capture is done, so its contents",
    "describe what happened rather than what you intended.",
  );

  return lines.join("\n");
}

// ── Report parsing ───────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function coerceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Parse raw report text into a {@link ReviewReport}.
 *
 * Lenient on purpose, but only in one direction. Unknown enum values are
 * coerced to their most alarming interpretation rather than dropped — an
 * unrecognized `severity` becomes `critical` and an unrecognized `action`
 * becomes `failed`, so a reviewer that garbles a field produces a report that
 * demands attention instead of one that quietly reads as clean. Structural
 * problems (not JSON, not an object, `findings` not an array) are hard errors:
 * there is nothing to salvage and pretending otherwise would report a clean
 * review that never happened.
 *
 * @returns the parsed report, or `null` when the text is not a usable report.
 */
export function parseReviewReport(raw: string): ReviewReport | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.findings)) return null;

  const findings: ReviewFinding[] = obj.findings
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && !Array.isArray(f))
    .map((f) => ({
      title: isNonEmptyString(f.title) ? f.title : "(untitled finding)",
      location: isNonEmptyString(f.location) ? f.location : undefined,
      severity: coerceEnum(f.severity, REVIEW_SEVERITIES, "critical"),
      verdict: coerceEnum(f.verdict, REVIEW_VERDICTS, "must-fix"),
      scenario: isNonEmptyString(f.scenario) ? f.scenario : "(no failure scenario recorded)",
      action: coerceEnum(f.action, REVIEW_ACTIONS, "failed"),
      itemId: isNonEmptyString(f.itemId) ? f.itemId : undefined,
      note: isNonEmptyString(f.note) ? f.note : undefined,
    }));

  return {
    taskId: isNonEmptyString(obj.taskId) ? obj.taskId : "",
    findings,
    fixesApplied: obj.fixesApplied === true,
    summary: isNonEmptyString(obj.summary) ? obj.summary : "(no summary recorded)",
  };
}

/**
 * Read and parse the report a review pass was asked to write.
 *
 * Distinguishes "the reviewer never wrote a report" from "the reviewer wrote
 * something unusable" — the two have different causes (a spawn that died vs. a
 * model that ignored the schema) and the caller surfaces them differently.
 */
export async function readReviewReport(path: string): Promise<ReviewPassOutcome> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    return {
      ok: false,
      reason: "no-report",
      detail: `No review report at ${path} (${(err as Error).message}).`,
    };
  }

  const report = parseReviewReport(raw);
  if (!report) {
    return {
      ok: false,
      reason: "malformed-report",
      detail: `Review report at ${path} is not a usable report (expected JSON with a findings array).`,
    };
  }
  return { ok: true, report };
}

// ── Summary rendering ────────────────────────────────────────────────────

/** Count findings by a keyed property. */
function tally<K extends string>(
  findings: readonly ReviewFinding[],
  key: (f: ReviewFinding) => K,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[key(f)] = (counts[key(f)] ?? 0) + 1;
  return counts;
}

/**
 * Render a report as the lines the run prints after the review pass.
 *
 * Every finding gets a line. There is no "and N more" truncation: a review
 * that hides part of its own result is the failure mode this pass exists to
 * avoid, and the report is already bounded by how many defects one task can
 * contain.
 */
export function formatReviewSummary(report: ReviewReport): string[] {
  if (report.findings.length === 0) {
    return ["No findings.", report.summary];
  }

  const byAction = tally(report.findings, (f) => f.action);
  const headline = REVIEW_ACTIONS.filter((a) => byAction[a])
    .map((a) => `${byAction[a]} ${a}`)
    .join(", ");

  const lines = [
    `${report.findings.length} finding(s): ${headline}`,
    "",
  ];

  for (const f of report.findings) {
    const where = f.location ? ` (${f.location})` : "";
    lines.push(`• [${f.severity}/${f.verdict} → ${f.action}] ${f.title}${where}`);
    lines.push(`    ${f.scenario}`);
    if (f.itemId) lines.push(`    captured as ${f.itemId}`);
    if (f.note) lines.push(`    ${f.note}`);
  }

  lines.push("", report.summary);
  return lines;
}

/**
 * Findings the pass tried to fix but could not, plus any it recorded as
 * `failed`. These are the ones a human must look at before trusting the
 * commit — everything else is either repaired, tracked, or reasoned away.
 */
export function unresolvedFindings(report: ReviewReport): ReviewFinding[] {
  return report.findings.filter(
    (f) => f.action === "failed" || (f.verdict === "must-fix" && f.action !== "fixed"),
  );
}
