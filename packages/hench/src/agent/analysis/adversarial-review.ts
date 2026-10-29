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

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { redactDeep } from "../../prd/llm-gateway.js";
import type { ReviewModelSource, RunReviewRecord } from "../../schema/index.js";

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

/**
 * A finding's recorded fate — the small closed set nothing downstream has to
 * guess about. Distinct from {@link ReviewAction}: `action` is what the pass
 * *did* (and can be `failed`, an execution outcome), while `disposition` is
 * the terminal category a finding's story ends in:
 *
 * - `fixed` — repaired in this pass (a `must-fix`, done).
 * - `dropped` — decided outright not worth acting on (`not-worth-fixing`),
 *   with no capture ever offered to anyone.
 * - `offered` — put in front of a capture decision, whether that decision was
 *   an interactive human prompt or an autonomous `add_item` call standing in
 *   for one. `action` and `itemId` say whether it was actually captured or
 *   declined; `reason` says why, when known.
 * - `deferred` — neither fixed nor offered yet: parked for the operator to
 *   see after the run instead of being lost. No decision has been made about
 *   it, which is what distinguishes it from `dropped`.
 */
export const REVIEW_DISPOSITIONS = ["fixed", "dropped", "offered", "deferred"] as const;
export type ReviewDisposition = (typeof REVIEW_DISPOSITIONS)[number];

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
  /**
   * What the code should do instead. Optional: a pair reviewer fills it in so
   * the executor, which is handed the finding to fix, is told the behaviour
   * wanted and not only the one observed.
   */
  expected?: string;
  /** What the pass did about it. */
  action: ReviewAction;
  /** Rex item id, when the finding was captured to the PRD. */
  itemId?: string;
  /** Free-text note — why it was dropped, what the fix changed, why capture failed. */
  note?: string;
  /**
   * The finding's recorded fate — see {@link ReviewDisposition}. Set at the
   * moment the fate is decided, not inferred later from `action`.
   *
   * Optional so a report written before this field existed still parses:
   * {@link parseReviewReport} leaves it `undefined` on an absent or
   * unrecognized value rather than guessing one, which is what lets an old
   * `.hench/reviews/<run>.json` keep loading unchanged.
   */
  disposition?: ReviewDisposition;
  /** Why: declined by the user, why deferred, what "not worth fixing" meant. */
  reason?: string;
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

/** The slice of the LLM config that can name a reviewer model. */
interface ReviewModelConfig {
  reviewModel?: string;
  claude?: { reviewModel?: string };
  codex?: { reviewModel?: string };
  google?: { reviewModel?: string };
  local?: { reviewModel?: string };
}

/**
 * Which setting `resolveReviewModel` takes the model from — the same
 * precedence, answering "which" where it answers "what". Recorded on the run
 * so the dashboard can say where the reviewer's model came from.
 */
export function reviewModelSource(
  vendor: string,
  config: ReviewModelConfig | undefined,
  flag: string | undefined,
): ReviewModelSource {
  if (flag) return "flag";
  const pinned =
    vendor === "claude"
      ? config?.claude?.reviewModel
      : vendor === "codex"
        ? config?.codex?.reviewModel
        : vendor === "google"
          ? config?.google?.reviewModel
          : config?.local?.reviewModel;
  if (pinned) return "vendor-config";
  if (config?.reviewModel) return "shared-config";
  return "vendor-default";
}

/** Why a review pass produced no usable report. */
export type ReviewFailureReason =
  | "no-report"
  | "malformed-report"
  | "spawn-failed"
  | "unsupported-vendor"
  /**
   * A pair review whose fix rounds ran out with a must-fix finding still open
   * (or whose fix session or tests broke). A verdict, not a missing review, so
   * it is not in {@link REVIEW_NEVER_RAN_REASONS} and `--review-optional` does
   * not excuse it.
   */
  | "must-fix-unresolved";

/**
 * The failure reasons meaning **no reviewer ever attacked the change**.
 *
 * The distinction the rest of the gate is built on. `spawn-failed` and
 * `unsupported-vendor` are both "the session never started" — a stale CLI, a
 * model the installed binary rejects, a vendor with no reviewer. Nothing read
 * the diff, so the operator has no review, only the absence of one.
 *
 * `no-report` and `malformed-report` are the opposite case: a reviewer did
 * run and did attack the change, and only the report transport broke. That is
 * a lost result, not an absent pass, and the module contract above keeps it a
 * warning rather than a refusal.
 */
export const REVIEW_NEVER_RAN_REASONS: readonly ReviewFailureReason[] = [
  "spawn-failed",
  "unsupported-vendor",
];

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
   * Project-relative PRD folder tree, with a trailing slash — `.rex/prd_tree/`
   * or `.ndx/rex/prd_tree/`.
   *
   * The duplicate check tells the reviewer to list this directory before
   * capturing a finding. Spelled out as `.rex/prd_tree/` it named nothing on a
   * `.ndx/` project, so the listing came back empty and the reviewer filed a
   * duplicate of an item that was already there.
   */
  prdTreeDir: string;
  /** v2 only: the Inbox folder, listed as well because unplaced changes wait there. */
  inboxDir?: string;
  /**
   * True when the reviewer is resuming the session that did the work. Changes
   * the brief substantially: a resumed reviewer already holds the context, so
   * the brief spends its length on posture rather than re-explaining the task.
   */
  resumed: boolean;
  /**
   * True when the run cannot ask the user anything — `--auto`, `--loop`,
   * `--yes`, or no TTY. Autonomous runs capture `should-fix` and
   * `out-of-scope` findings themselves. Attended runs leave them uncaptured
   * for the run to queue: the operator is attached to the run, but the
   * reviewer is a headless session that could never receive their selection.
   */
  autonomous: boolean;
  /**
   * True when hench's test gate runs right after this review (not
   * `--skip-test-gate`). The reviewer then runs scoped checks only and leaves
   * the full suite to the gate and CI (#539).
   */
  testGateFollows: boolean;
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
 * v2 only: the dedupe listing of `changes/` does not reach `changes/inbox/`
 * (no `index.md`, no matching slug), yet unplaced captures wait there.
 */
function inboxClause(ctx: { inboxDir?: string }): string {
  return ctx.inboxDir ? ` and under \`${ctx.inboxDir}\`, where unplaced changes wait,` : "";
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
    ctx.testGateFollows
      ? "Three deviations from the skill's default flow, because this run is automated:"
      : "Two deviations from the skill's default flow, because this run is automated:",
    "",
  );

  if (ctx.autonomous) {
    lines.push(
      "- **Do not stop to ask.** The skill's Step 5 waits for a human to approve",
      "  what gets captured. There is no human attached to this run. Apply the",
      "  policy below instead.",
    );
  } else {
    // The skill's Step 5 asks and waits. This session cannot hear an answer:
    // it is `claude -p`, so a question ends the turn and the findings were
    // left `offered` with nothing queuing them (runs a32aeeb0, 8dc53406).
    lines.push(
      "- **Do not stop to ask, and do not capture.** A human is attached to this",
      "  run, but not to this session: it runs headless and cannot receive a",
      "  reply, so a question asked here is never answered. Report `should-fix`",
      "  and `out-of-scope` findings without capturing them. The run queues them,",
      "  and the operator chooses what to capture after it ends.",
    );
  }
  lines.push(
    "- **Write the machine-readable report** described under Output below. This",
    "  is in addition to whatever you print for the human, not instead of it.",
  );
  if (ctx.testGateFollows) {
    lines.push(
      "- **Scoped checks only.** Step 2 of the skill runs only the scoped checks",
      "  for the files in the diff, plus the static checks. Do not run the full",
      "  suite: hench's test gate runs right after this review, and CI runs",
      "  everything. Name the full suite in your report as what was not",
      "  exercised — that is Step 4's input.",
    );
  }
  lines.push("");

  lines.push("## What to do with each finding");
  lines.push("");
  lines.push(
    "| Verdict | Action | Record as | disposition |",
    "|---|---|---|---|",
    "| `must-fix` | Fix it now, in this session. Add or update the test that would have caught it. Re-run the project's checks after the fix. | `fixed` | `fixed` |",
    ctx.autonomous
      ? "| `should-fix` | Capture as a PRD task with `add_item` (rex MCP). Do not fix it here. | `captured` | `offered` |"
      : "| `should-fix` | Report it. Do not capture it and do not fix it here — the run queues it for the operator. | `dropped` | `offered` |",
    ctx.autonomous
      ? "| `out-of-scope` | Capture under the area it actually belongs to, never under this change. | `captured` | `offered` |"
      : "| `out-of-scope` | Report it under the area it actually belongs to. Do not capture it — the run queues it for the operator. | `dropped` | `offered` |",
    "| `not-worth-fixing` | Nothing. Report it with the reason — unreachable, already covered, or fix costs more than the defect. | `dropped` | `dropped` |",
    "",
    // On a v2 tree `add_item` files an untargeted change in the Inbox with
    // `needsPlacement`, and nothing autonomous selects it from there.
    ...(ctx.autonomous
      ? [
          "On a v2 PRD a captured item is a change in the Inbox: place it with `place_change`",
          "on the capability or constraint it belongs to, or it is never selected",
          "autonomously.",
          "",
        ]
      : []),
    "`disposition` records a finding's fate on its own closed scale of",
    "`fixed | dropped | offered | deferred`, set at the moment you decide it —",
    "every finding needs one. `offered` covers both a capture that succeeded",
    "and one the user declined; `action` and `itemId` already carry that",
    "distinction, and `reason` should say which (e.g. \"declined by user\", or",
    "left unset when captured). Use `reason` on `dropped` too, for why. Do not",
    "write `deferred` yourself: the run sets it, on any finding it cannot see a",
    "decision behind. Record what you actually did and let it park the rest.",
    "",
    "Before creating any PRD item, check whether one already tracks the same",
    `defect: list the directories under \`${ctx.prdTreeDir}\`${inboxClause(ctx)} and read the \`index.md\``,
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
    ctx.testGateFollows
      ? "- **Read-only project checks only.** Scoped tests, typecheck, and lint are fine."
      : "- **Read-only project checks only.** Tests, typecheck, and lint are fine.",
    "  Never run `ndx ci`, `ndx plan`, `ndx analyze`, `ndx refresh`, formatters",
    "  in write mode, codegen, migrations, or snapshot updates (`-u`) — they",
    "  rewrite state this run is concurrently writing.",
    "- **If a fix does not work, stop and report it.** Record the finding as",
    "  `failed` with what you tried. A half-applied fix is worse than none.",
    "",
  );

  lines.push(
    ...reportOutputLines(ctx, {
      fixesApplied: "Set `fixesApplied` to true only if you actually edited a file.",
      writeLast: "Write the file last, after every fix and capture is done, so its contents",
    }),
  );

  return lines.join("\n");
}

/** Prose that differs between the self and pair reports; the schema itself is shared. */
interface ReportOutputWording {
  /** The sentence about `fixesApplied`. */
  fixesApplied: string;
  /** First line of the closing "write the file last" paragraph; the second line is common. */
  writeLast: string;
}

/**
 * The "Output" section of a review brief — the report path, JSON schema and
 * the rule that every finding is accounted for. Shared by the self and pair
 * briefs so a change to the report format cannot reach one and miss the other.
 */
function reportOutputLines(
  ctx: Pick<ReviewPromptContext, "taskId" | "reportPath">,
  wording: ReportOutputWording,
): string[] {
  return [
    "## Output",
    "",
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
    '      "expected": "What the code should do instead (optional)",',
    '      "action": "fixed | captured | dropped | failed",',
    '      "itemId": "rex item id, when captured",',
    '      "note": "Why dropped / what the fix changed / why capture failed",',
    '      "disposition": "fixed | dropped | offered | deferred",',
    '      "reason": "Why dropped, or why declined, when known"',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "`findings` must account for every finding that survived Pass 1, including",
    "the ones you dropped — a finding that vanishes without a verdict, an",
    "action, and a `disposition` is a review hiding its own result. An empty",
    "array is a valid and useful report when the attack genuinely found",
    "nothing; say what you attacked in `summary` so the next reader can judge",
    "whether it was aimed correctly.",
    "",
    wording.fixesApplied,
    "",
    wording.writeLast,
    "describe what happened rather than what you intended.",
  ];
}

// ── Pair review prompts ──────────────────────────────────────────────────

/**
 * Cap on the diff text embedded in a pair brief. A fresh reviewer has no other
 * way to see the change, so the diff is inlined; past this size it is cut and
 * the brief says how to read the rest from git.
 */
export const PAIR_REVIEW_DIFF_CHAR_LIMIT = 200_000;

/** Everything {@link buildPairReviewBrief} needs. The reviewer starts with no context at all. */
export interface PairReviewPromptContext {
  taskId: string;
  taskTitle: string;
  /** The task as the executor was briefed on it: description and acceptance criteria. */
  taskBrief: string;
  /** Commit the tree sat at before the run, or undefined when it could not be captured. */
  startingHead?: string;
  /** `git diff <startingHead>` (or `git diff HEAD`), untruncated. */
  diff: string;
  /** Paths the run changed, including untracked ones. */
  changedFiles: readonly string[];
  /** Absolute path the reviewer must write its JSON report to. */
  reportPath: string;
  /** Project-relative PRD folder tree, with a trailing slash. */
  prdTreeDir: string;
  /** v2 only: the Inbox folder, listed as well because unplaced changes wait there. */
  inboxDir?: string;
  /** True when no human is attached: the reviewer captures findings itself. */
  autonomous: boolean;
  /** True when hench's test gate runs right after this review. */
  testGateFollows: boolean;
  /**
   * Set on a re-review, after the executor tried to fix the previous round's
   * must-fix findings. Absent on the first review.
   */
  recheck?: PairRecheck;
  /**
   * True when the executor will be handed this report's must-fix findings, so
   * the reviewer reports them and does not capture them. False (the default)
   * on the last review, after which a must-fix finding that remains is
   * captured like any other.
   */
  executorFixesMustFix?: boolean;
}

/** What a pair re-review is told about the round before it. */
export interface PairRecheck {
  /** 1-based fix round that just ran. */
  round: number;
  /** The must-fix findings the executor was asked to fix. */
  mustFix: readonly ReviewFinding[];
}

/** The task text a pair reviewer is given: description, then acceptance criteria as a checklist. */
export function pairTaskBrief(task: { description?: string; acceptanceCriteria?: readonly string[] }): string {
  const parts: string[] = [];
  if (task.description?.trim()) parts.push(task.description.trim());
  if (task.acceptanceCriteria?.length) {
    parts.push(["Acceptance criteria:", ...task.acceptanceCriteria.map((c) => `- ${c}`)].join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * System prompt for a pair reviewer: the adversarial posture of
 * {@link buildReviewSystemPrompt}, plus the rule that defines pair mode — the
 * reviewer reports and the executor fixes.
 */
export function buildPairReviewSystemPrompt(): string {
  return [
    buildReviewSystemPrompt(),
    "",
    "You are a different assistant from the one that wrote this change, in a",
    "fresh session, and you did not write any of it. Report only: you MUST NOT",
    "edit, create, move or delete any file except the JSON report you are told",
    "to write. Fixing is the executor's job. A file you change is a change nobody",
    "reviewed.",
  ].join("\n");
}

/** Cut `diff` to {@link PAIR_REVIEW_DIFF_CHAR_LIMIT}, reporting whether anything was lost. */
export function truncatePairDiff(diff: string): { text: string; truncated: boolean } {
  if (diff.length <= PAIR_REVIEW_DIFF_CHAR_LIMIT) return { text: diff, truncated: false };
  return { text: diff.slice(0, PAIR_REVIEW_DIFF_CHAR_LIMIT), truncated: true };
}

/**
 * The brief for a pair reviewer: the task, the changed files and the diff,
 * inline, since a different vendor's CLI cannot resume the executor's session.
 */
export function buildPairReviewBrief(ctx: PairReviewPromptContext): string {
  const { text: diffText, truncated } = truncatePairDiff(ctx.diff);
  // The verdicts this reviewer captures itself. A must-fix finding the executor
  // is about to fix is reported, not captured.
  const capturedVerdicts = ctx.executorFixesMustFix
    ? "`should-fix`, `out-of-scope`"
    : "`must-fix`, `should-fix`, `out-of-scope`";
  const diffCommand = ctx.startingHead ? `git diff ${ctx.startingHead}` : "git diff HEAD";
  const lines: string[] = [
    "# Pair review pass",
    "",
    "Another assistant just completed the task below and its change is about to be",
    "committed. Review that change adversarially. You have none of that assistant's",
    "context: the task, the changed files and the diff are all below.",
    "",
    `Task: ${ctx.taskId} — ${ctx.taskTitle}`,
    "",
    "## Task as briefed",
    "",
    ctx.taskBrief.trim() || "(no description or acceptance criteria)",
    "",
    "## Changed files",
    "",
    ...(ctx.changedFiles.length > 0 ? ctx.changedFiles.map((f) => `- ${f}`) : ["(none)"]),
    "",
    "## Diff",
    "",
    `Output of \`${diffCommand}\`:`,
    "",
    "```diff",
    diffText,
    "```",
  ];
  if (truncated) {
    lines.push(
      "",
      `The diff above was cut at ${PAIR_REVIEW_DIFF_CHAR_LIMIT} characters. Read the rest with`,
      `\`${diffCommand} -- <path>\` for each changed file you have not seen.`,
    );
  }
  if (!ctx.startingHead) {
    lines.push(
      "",
      "The pre-run commit could not be captured, so this is the diff against HEAD and",
      "may miss work the run already committed. Say so in your summary.",
    );
  }
  lines.push(
    "",
    "Untracked files appear in the list above but not in the diff; read them from disk.",
  );
  if (ctx.recheck) lines.push("", ...recheckLines(ctx.recheck));
  lines.push(
    "",
    "## Method",
    "",
    "Run the `/ndx-adversarial-review` skill if you have it, otherwise follow its",
    "method: build ground truth from the code, attack the change, then decide",
    "necessity. Check the change against the acceptance criteria above.",
    ctx.testGateFollows
      ? "Run scoped checks for the files in the diff only; hench's test gate runs the full suite next."
      : "Read-only project checks (tests, typecheck, lint) are fine.",
    "",
    "## Report only",
    "",
    "- **Edit no files** except the JSON report below. Do not fix anything, even a",
    "  one-line must-fix: the executor fixes. `fixed` is never a valid `action` here.",
    "- Do not commit, reset, checkout or clean, and do not change the task's status.",
    "  Never run `ndx ci`, `ndx plan`, `ndx analyze` or `ndx refresh`.",
    "",
    "## What to do with each finding",
    "",
    "| Verdict | Action | Record as | disposition |",
    "|---|---|---|---|",
    ...(ctx.executorFixesMustFix
      ? [
          "| `must-fix` | Report it, with `expected` saying what the code should do. Do not capture it: the executor is asked to fix it and you check again. | `dropped` | `offered` |",
        ]
      : []),
    ctx.autonomous
      ? `| ${capturedVerdicts} | Capture as a PRD task with \`add_item\` (rex MCP), under the area it belongs to. | \`captured\` | \`offered\` |`
      : `| ${capturedVerdicts} | Report it. Do not capture it — the run queues it for the operator. | \`dropped\` | \`offered\` |`,
    "| `not-worth-fixing` | Nothing. Report it with the reason. | `dropped` | `dropped` |",
    "",
    "Do not write `deferred` as a disposition; the run sets it.",
    ...(ctx.autonomous
      ? [
          "",
          `Before creating an item, list the directories under \`${ctx.prdTreeDir}\`${inboxClause(ctx)} and read the`,
          "`index.md` of any whose slug is plausibly related. If the defect is already tracked,",
          "record the finding as `captured` with that item's id instead of creating a duplicate.",
          "When you create one, set `priority` to the severity, `tags` to",
          "`ndx-adversarial-review` and `severity:<level>`, and `source` to `ndx-adversarial-review`.",
          "On a v2 PRD the item is a change in the Inbox: place it with `place_change` on the",
          "capability or constraint it belongs to, or it is never selected autonomously.",
        ]
      : []),
    "",
    ...reportOutputLines(ctx, {
      fixesApplied: "Set `fixesApplied` to false: you edit nothing.",
      writeLast: "Write the file last, after every capture is done, so its contents",
    }),
  );
  return lines.join("\n");
}

// ── Pair review: fix rounds ──────────────────────────────────────────────

function recheckLines(recheck: PairRecheck): string[] {
  return [
    "## Previous round",
    "",
    `The executor was asked to fix ${recheck.mustFix.length} must-fix finding(s) from the last review`,
    `(fix round ${recheck.round}); the diff above includes its fix. Confirm each one against the code now:`,
    "",
    ...recheck.mustFix.map(
      (f) => `- **${f.title}**${f.location ? ` (${f.location})` : ""} — ${f.scenario}`,
    ),
    "",
    "A finding that is fixed is not reported again. One that is still broken is reported",
    "again with the **same `title`**, verdict `must-fix`, and `scenario` saying what is",
    "still wrong. Also report anything new, including what the fix broke. Findings below",
    "must-fix from the last review are already recorded: do not report them again.",
  ];
}

/** System prompt for the executor session resumed to fix a reviewer's findings. */
export function buildExecutorFixSystemPrompt(): string {
  return [
    "You are fixing review findings inside an automated `ndx work` run.",
    "A reviewer from a different vendor read your change and found defects in it.",
    "Fix exactly what is listed. Do not defend the earlier code, and do not widen the diff.",
  ].join("\n");
}

/** Everything {@link buildExecutorFixPrompt} needs. */
export interface ExecutorFixPromptContext {
  /** 1-based fix round. */
  round: number;
  /** Fix rounds the run allows. */
  rounds: number;
  /** The must-fix findings to fix. */
  findings: readonly ReviewFinding[];
  /** True when this is the executor's own session, which already holds the task. */
  resumed: boolean;
  /** The task as briefed, for a fresh session that holds none of it. */
  taskBrief?: string;
  taskTitle: string;
}

/**
 * The prompt that resumes the executor with the reviewer's must-fix findings:
 * each with its file, the failure trigger and the behaviour wanted.
 */
export function buildExecutorFixPrompt(ctx: ExecutorFixPromptContext): string {
  const lines = [
    `# Fix the reviewer's must-fix findings (round ${ctx.round} of ${ctx.rounds})`,
    "",
    ctx.resumed
      ? "A reviewer from a different vendor read your change and found the defects below."
      : `A reviewer from a different vendor read the change made for "${ctx.taskTitle}" and found the defects below. ` +
        "You are in a fresh session: read the change with `git diff` before fixing.",
    "",
  ];
  if (!ctx.resumed && ctx.taskBrief?.trim()) lines.push("## Task as briefed", "", ctx.taskBrief.trim(), "");
  ctx.findings.forEach((f, i) => {
    lines.push(
      `## ${i + 1}. ${f.title}`,
      "",
      `- File: ${f.location ?? "(not given)"}`,
      `- Failure trigger: ${f.scenario}`,
      `- Expected behaviour: ${f.expected ?? "the trigger above must stop producing the wrong result"}`,
      "",
    );
  });
  lines.push(
    "## Rules",
    "",
    "- Fix these findings and nothing else: no refactors, no other cleanup.",
    "- Add or update the test that fails without each fix, then run the scoped checks for the files you touched.",
    "- If you committed the task's work, commit the fix the same way, with the same trailers. If you did not, do not start now.",
    "- Do not change the task's status. Never run `ndx ci`, `ndx plan`, `ndx analyze` or `ndx refresh`.",
    "- If a finding is wrong, say so in your final message with the guard that makes it impossible; the reviewer checks again.",
  );
  return lines.join("\n");
}

const normalizeTitle = (title: string): string => title.trim().toLowerCase();

/** How many of `previous` the `current` report no longer lists as a must-fix finding. Matched by title. */
export function countFixedFindings(
  previous: readonly ReviewFinding[],
  current: readonly ReviewFinding[],
): number {
  const open = new Set(current.filter((f) => f.verdict === "must-fix").map((f) => normalizeTitle(f.title)));
  return previous.filter((f) => !open.has(normalizeTitle(f.title))).length;
}

/**
 * Copy the findings below must-fix from an earlier round's report into the
 * current one, so the last report is the whole review and not just its last
 * round. A re-review is told not to repeat them, and an attended run's queue
 * (`hench review pending`) reads only the last report.
 *
 * Edits the raw JSON, so a key the parser does not model survives, as in
 * {@link mergeDispositionsIntoRaw}. Must-fix entries are not copied: the executor
 * had them, and the re-review reports the ones still open.
 *
 * @returns false when either file could not be read or is not a findings
 *   report; the current report is then left as it was.
 */
export async function carryForwardFindings(previousPath: string, currentPath: string): Promise<boolean> {
  try {
    const previous: unknown = JSON.parse(await readFile(previousPath, "utf-8"));
    const current: unknown = JSON.parse(await readFile(currentPath, "utf-8"));
    if (!isFindingObject(previous) || !isFindingObject(current)) return false;
    if (!Array.isArray(previous.findings) || !Array.isArray(current.findings)) return false;

    const present = new Set(
      current.findings.filter(isFindingObject).map((f) => normalizeTitle(String(f.title ?? ""))),
    );
    const carried = previous.findings
      .filter(isFindingObject)
      .filter((f) => f.verdict !== "must-fix" && !present.has(normalizeTitle(String(f.title ?? ""))));
    if (carried.length === 0) return true;

    current.findings.push(...carried);
    // A finding quotes the diff it is about, and a diff can carry a credential;
    // what reaches disk gets the same scrub as the run record.
    await writeFile(currentPath, `${JSON.stringify(redactDeep(current), null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** The refusal text for a pair review that ended with must-fix findings still open. */
export function formatUnresolvedMustFixRefusal(review: FailedReviewRecord): string {
  return [
    "Refusing to report this task completed: the pair review did not pass.",
    `  ${review.detail}`,
    ...(review.reportPath ? [`  Report: ${review.reportPath}`] : []),
    "  The work is left in place. Findings the reviewer did not capture to the PRD",
    "  are listed by `hench review pending <run-id>`.",
  ].join("\n");
}

// ── Report parsing ───────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * The entries {@link parseReviewReport} models — a plain JSON object.
 *
 * Shared with {@link mergeDispositionsIntoRaw} on purpose. That merge walks the
 * *raw* findings array and has to skip exactly the entries the parser skipped,
 * or every disposition after the first malformed entry lands on the wrong
 * finding. A second copy of this predicate is a second definition of which
 * entries are findings, free to drift from the one the parser uses.
 */
function isFindingObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
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
 * Like {@link coerceEnum} but for an optional field with no safe fallback to
 * guess: an absent or unrecognized `disposition` becomes `undefined` rather
 * than a value that would claim a fate nobody recorded. This is what keeps a
 * pre-disposition `.hench/reviews/<run>.json` loading unchanged.
 */
function coerceOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
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
    .filter(isFindingObject)
    .map((f) => ({
      title: isNonEmptyString(f.title) ? f.title : "(untitled finding)",
      location: isNonEmptyString(f.location) ? f.location : undefined,
      severity: coerceEnum(f.severity, REVIEW_SEVERITIES, "critical"),
      verdict: coerceEnum(f.verdict, REVIEW_VERDICTS, "must-fix"),
      scenario: isNonEmptyString(f.scenario) ? f.scenario : "(no failure scenario recorded)",
      expected: isNonEmptyString(f.expected) ? f.expected : undefined,
      action: coerceEnum(f.action, REVIEW_ACTIONS, "failed"),
      itemId: isNonEmptyString(f.itemId) ? f.itemId : undefined,
      note: isNonEmptyString(f.note) ? f.note : undefined,
      disposition: coerceOptionalEnum(f.disposition, REVIEW_DISPOSITIONS),
      reason: isNonEmptyString(f.reason) ? f.reason : undefined,
    }));

  return {
    taskId: isNonEmptyString(obj.taskId) ? obj.taskId : "",
    findings,
    fixesApplied: obj.fixesApplied === true,
    summary: isNonEmptyString(obj.summary) ? obj.summary : "(no summary recorded)",
  };
}

/**
 * Patch derived dispositions into the reviewer's own JSON, returning the text
 * to write back.
 *
 * **Why not just re-serialize the parsed report.** {@link parseReviewReport} is
 * a lossy projection: it keeps ten known fields per finding and drops
 * everything else, and it filters out entries that are not JSON objects.
 * Writing that projection back over the reviewer's file destroys whatever it
 * could not model — a `proposedSolutions` array the skill asked for but this
 * brief has no field for, a top-level note, and, worst of all, a finding the
 * reviewer wrote in a shape the parser skipped. A malformed finding is still a
 * finding a human can read; erasing it to record a disposition would lose
 * review findings in the name of a feature built to stop losing them.
 *
 * So the merge edits the parsed-from-disk structure in place and re-emits it:
 * every key the reviewer wrote survives, and only `disposition` is added.
 *
 * **Index alignment is the trap.** The parsed report's findings are the raw
 * array *minus* the entries {@link isFindingObject} rejects, so the two arrays
 * do not share indices once a malformed entry exists. The cursor below
 * advances only on entries the parser also kept, which is why both sides must
 * use the same predicate.
 *
 * @returns the JSON text to write, or `null` when the raw text is no longer a
 *   report the merge can align against — in which case the caller must leave
 *   the file alone rather than overwrite it with something lossy.
 */
export function mergeDispositionsIntoRaw(
  rawText: string,
  parked: ReviewReport,
): string | null {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!isFindingObject(data)) return null;

  const rawFindings = data.findings;
  if (!Array.isArray(rawFindings)) return null;

  let cursor = 0;
  for (const entry of rawFindings) {
    if (!isFindingObject(entry)) continue;
    const disposition = parked.findings[cursor++]?.disposition;
    if (disposition) entry.disposition = disposition;
  }

  // The text goes back to `.hench/reviews/`; see carryForwardFindings.
  return `${JSON.stringify(redactDeep(data), null, 2)}\n`;
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
    if (f.disposition) {
      lines.push(`    disposition: ${f.disposition}${f.reason ? ` — ${f.reason}` : ""}`);
    }
  }

  lines.push("", report.summary);
  return lines;
}

// ── Deferred findings (the non-interactive capture queue) ────────────────

/**
 * A deferred finding paired with the id the operator addresses it by.
 *
 * The id is positional within the report's `findings` array, which is safe
 * precisely because that array is written once and never appended to: the
 * report file is the record of a single pass. Numbering over the *full* array
 * rather than over the deferred subset is deliberate — `f3` must mean the same
 * finding whether the reader filtered for deferrals or read the whole report,
 * or the id stops being an address.
 */
export interface DeferredFinding {
  /** `f<1-based index>` within {@link ReviewReport#findings}. */
  id: string;
  finding: ReviewFinding;
}

/** The id a finding at `index` in the report's findings array is addressed by. */
export function reviewFindingId(index: number): string {
  return `f${index + 1}`;
}

/**
 * The fate a finding actually earned, derived from what the pass *did*.
 *
 * Deliberately ignores any `disposition` the reviewer wrote. The reviewer's
 * bookkeeping is the thing that failed here: told to offer a `should-fix` and
 * left with nobody to offer it to, it records `dropped` — a decision word for
 * a decision nobody made — and the finding is then indistinguishable from one
 * that was reasoned away. So the run re-derives the fate from `action` and
 * `verdict`, the two fields the reviewer has always emitted and that
 * {@link classifyUnresolved} already trusts.
 *
 * Only three outcomes are evidence of a decision: a repair in the tree, an
 * item id in the PRD, and a `not-worth-fixing` verdict carrying its own
 * reasoning. Everything else — a capture with no item to show for it, an
 * action that failed, a verdict above `not-worth-fixing` that ended in
 * `dropped` — is a finding nobody ruled on, and becomes `deferred`.
 */
export function deriveDisposition(f: ReviewFinding): ReviewDisposition {
  if (f.action === "fixed") return "fixed";
  if (f.action === "captured" && f.itemId) return "offered";
  if (f.action === "dropped" && f.verdict === "not-worth-fixing") return "dropped";
  return "deferred";
}

/**
 * Give every finding in a report the fate it earned, parking the undecided
 * ones as `deferred`.
 *
 * Returns a new report; the input is left alone so a caller can still show
 * what the reviewer claimed alongside what the run concluded.
 *
 * Applied to every reviewed run. The reviewer is always a headless session,
 * so no human is ever at its capture prompt: on an autonomous run it captures
 * by policy, and on an attended run it is told to leave the choice to the
 * operator, who reads the queue after the run.
 */
export function parkDeferredFindings(report: ReviewReport): ReviewReport {
  return {
    ...report,
    findings: report.findings.map((f) => ({ ...f, disposition: deriveDisposition(f) })),
  };
}

/**
 * The parked findings of a report, with their ids.
 *
 * Reads the recorded `disposition` rather than re-deriving it: by the time
 * anything calls this the report on disk has already been rewritten by
 * {@link parkDeferredFindings}, and a second derivation here would be a second
 * definition of what "deferred" means, free to drift from the first.
 */
export function deferredFindings(report: ReviewReport): DeferredFinding[] {
  return report.findings
    .map((finding, index) => ({ id: reviewFindingId(index), finding }))
    .filter((entry) => entry.finding.disposition === "deferred");
}

/**
 * Render the parked findings as the lines `hench review pending` prints.
 *
 * Carries the full failure scenario, not just the title. The operator reading
 * this is deciding whether to spend a PRD item on the finding, and a title
 * alone ("Claim refresh drops the holder pid") cannot support that decision —
 * the scenario is the evidence, and it is the part that would otherwise have
 * to be reconstructed from a review that has long since scrolled away.
 */
export function formatDeferredFindings(
  runId: string,
  reportPath: string,
  deferred: readonly DeferredFinding[],
): string[] {
  if (deferred.length === 0) {
    return [`No deferred findings for run ${runId}.`, `Review record: ${reportPath}`];
  }

  const lines = [
    `${deferred.length} deferred finding(s) from run ${runId}:`,
    `Review record: ${reportPath}`,
    "",
  ];

  for (const { id, finding: f } of deferred) {
    lines.push(`  ${id}  [${f.severity}/${f.verdict}] ${f.title}`);
    if (f.location) lines.push(`      ${f.location}`);
    lines.push(`      ${f.scenario}`);
    if (f.reason) lines.push(`      reason: ${f.reason}`);
    if (f.note) lines.push(`      ${f.note}`);
    lines.push("");
  }

  lines.push(
    "Capture what is worth tracking with the /ndx-adversarial-review skill,",
    `naming the run and the ids above (e.g. "capture ${deferred[0].id} from run ${runId}").`,
  );
  return lines;
}

/**
 * Unresolved findings split by *why* they are unresolved.
 *
 * The two reasons carry different urgency and must not share a label: a
 * must-fix the pass could not repair is a defect still in the tree, while a
 * should-fix whose PRD capture failed is a bookkeeping miss. Reporting the
 * combined count as must-fix overstated the severity (run 4b4526c5 warned of
 * an unrepaired must-fix when the only finding was a low/should-fix failed
 * capture) and would have eroded trust in the warning.
 */
export interface UnresolvedBreakdown {
  /** Must-fix findings that were not repaired — a defect a human must look at. */
  unrepairedMustFix: ReviewFinding[];
  /**
   * Findings below must-fix whose action failed (e.g. the PRD capture threw).
   * The code is fine; the record of it is not. A failed *must-fix* belongs to
   * `unrepairedMustFix`, never here, so the two buckets never double-count.
   */
  failedActions: ReviewFinding[];
  /** Both buckets, in report order — what {@link unresolvedFindings} returns. */
  all: ReviewFinding[];
}

/** Partition the unresolved findings. See {@link UnresolvedBreakdown}. */
export function classifyUnresolved(report: ReviewReport): UnresolvedBreakdown {
  const isUnrepairedMustFix = (f: ReviewFinding): boolean =>
    f.verdict === "must-fix" && f.action !== "fixed";

  return {
    unrepairedMustFix: report.findings.filter(isUnrepairedMustFix),
    failedActions: report.findings.filter(
      (f) => f.action === "failed" && !isUnrepairedMustFix(f),
    ),
    all: report.findings.filter((f) => isUnrepairedMustFix(f) || f.action === "failed"),
  };
}

/**
 * Findings the pass tried to fix but could not, plus any it recorded as
 * `failed`. These are the ones a human must look at before trusting the
 * commit — everything else is either repaired, tracked, or reasoned away.
 *
 * The union of both {@link UnresolvedBreakdown} buckets. Use
 * {@link classifyUnresolved} when the two need distinct labels or counts.
 */
export function unresolvedFindings(report: ReviewReport): ReviewFinding[] {
  return classifyUnresolved(report).all;
}

/**
 * Operator warning for the unresolved findings, one line per reason, or `[]`
 * when everything resolved. Returned as lines (like
 * {@link formatReviewSummary}) so the caller owns the output channel and the
 * wording stays testable.
 */
export function formatUnresolvedWarning(report: ReviewReport): string[] {
  const { unrepairedMustFix, failedActions } = classifyUnresolved(report);
  if (unrepairedMustFix.length === 0 && failedActions.length === 0) return [];

  const lines = [""];
  if (unrepairedMustFix.length > 0) {
    lines.push(`⚠ ${unrepairedMustFix.length} must-fix finding(s) were not repaired.`);
  }
  if (failedActions.length > 0) {
    lines.push(
      `⚠ ${failedActions.length} finding(s) below must-fix could not be processed ` +
        "(e.g. a PRD capture that failed).",
    );
  }
  lines.push("Inspect them before trusting this commit.");
  return lines;
}

// ── The missing-review gate ──────────────────────────────────────────────

/** The failed half of {@link RunReviewRecord}, as narrowed by {@link reviewNeverRan}. */
export type FailedReviewRecord = Extract<RunReviewRecord, { failed: string }>;

/**
 * True when the record says a reviewer never ran.
 *
 * See {@link REVIEW_NEVER_RAN_REASONS} for why only two of the four failure
 * reasons qualify. False for a successful pass, for an absent one (`--review`
 * was not passed), and for a reviewer that ran but lost its report.
 */
export function reviewNeverRan(
  review: RunReviewRecord | undefined,
): review is FailedReviewRecord {
  if (!review || review.failed === undefined) return false;
  return REVIEW_NEVER_RAN_REASONS.includes(review.failed as ReviewFailureReason);
}

/**
 * The refusal text for a run whose reviewer never started.
 *
 * Names the missing review first, because the thing an operator must not
 * conclude from this run is "reviewed, nothing found". The remedy lines matter
 * as much as the diagnosis: the common cause is a `--review-model` the
 * installed vendor CLI does not know, which is a one-line fix followed by a
 * re-run — not a defect in the task.
 */
export function formatMissingReviewRefusal(review: FailedReviewRecord): string {
  return [
    `Refusing to report this task completed: the adversarial review never ran (${review.failed}).`,
    `  ${review.detail}`,
    "  --review is a gate. A reviewer that could not start is not a reviewer that",
    "  found nothing, so the run does not get to claim a reviewed completion.",
    "  The work itself validated and is left in place — fix the reviewer (usually",
    "  --review-model or the vendor CLI version) and re-run, or pass",
    "  --review-optional to accept best-effort review.",
  ].join("\n");
}

/**
 * The review line for the end-of-run summary, or `[]` when `--review` was off.
 *
 * The mid-run review output scrolls away behind the test gate and the commit
 * prompt, so a run that was never reviewed looked identical at the bottom of
 * the terminal to one that was. This is the line that tells them apart, and it
 * is printed on the best-effort path too — where the run *does* complete.
 *
 * @param runId  The run these lines describe. Optional only because the two
 *   call sites that have it are not the only conceivable ones; when given, the
 *   deferred block can name the exact command that lists the parked findings
 *   instead of leaving the reader to work out the id.
 */
export function formatRunReviewStatus(
  review: RunReviewRecord | undefined,
  runId?: string,
): string[] {
  if (!review) return [];

  if (review.failed === "must-fix-unresolved") {
    return [`Review: ⚠ DID NOT PASS — ${review.detail}`, ...(review.reportPath ? [`        ${review.reportPath}`] : [])];
  }

  if (review.failed !== undefined) {
    const verb = reviewNeverRan(review) ? "NEVER RAN" : "PRODUCED NO REPORT";
    return [
      `Review: ⚠ ${verb} (${review.failed}) — this task was NOT reviewed`,
      `        ${review.detail}`,
    ];
  }

  const model = review.model || "the loaded model";
  const unresolved =
    review.unresolvedCount > 0 ? `, ${review.unresolvedCount} unresolved` : "";
  const lines = [`Review: ${review.findingCount} finding(s)${unresolved} (${model})`];

  // Only when something was actually parked. A "0 deferred" line on a record
  // that predates the field would claim the run considered a question it never
  // asked, and on a clean interactive run it is simply noise.
  if (review.deferredCount) {
    lines.push(
      `        ${review.deferredCount} deferred for capture — ${review.reportPath}`,
      `        List them: hench review pending ${runId ?? "<run-id>"}`,
    );
  }

  return lines;
}
