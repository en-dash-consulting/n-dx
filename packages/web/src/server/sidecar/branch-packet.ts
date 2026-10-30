/**
 * The Diagnose branch packet: one worktree's branch health, as R2's
 * collector found it, with the card that carries out each next step.
 *
 * Every class and every fix comes from `branch-health/` (fixed rules, no
 * model). This module only renders them and names the broker call for each:
 * a conflict's steps as `run_command` cards, an allowlist union's diff as a
 * `propose_edit`, a duplicate capture as a `propose_prd_change`, and nothing
 * for a source conflict, which names its owners instead. A failing check is
 * "failing on main" only once a `github_read` of that check on the base says
 * so; the packet names that call and never the class.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §5 (Q6).
 */

import type { BranchHealth, CheckFailureClass, ConflictClass, FailingCheck, GithubFacts, PredictedConflict } from "../branch-health/index.js";
import { DIAGNOSE_BRANCH_INSTRUCTIONS } from "./lens-instructions.js";
import { assemblePacket, type Packet, type PacketSection } from "./packet.js";
import type { BranchHealthRead, PacketSources } from "./packet-sources.js";

export const DIAGNOSE_BRANCH_CAP = 8_000;

/** The most of one failed check's stored log tail the packet carries, kept from the end. */
export const BRANCH_LOG_TAIL_CHARS = 1_200;

/** A check class as the answer names it. */
export const CHECK_CLASS_LABELS: Readonly<Record<CheckFailureClass, string>> = {
  "touched-test": "touched test",
  "behind-base": "behind base",
  "policy-test": "policy test",
  codeql: "CodeQL",
  "fork-no-ci": "fork",
  unclassified: "unclassified",
};

/** The card each conflict class's fix goes on. */
const CONFLICT_CARDS: Readonly<Record<ConflictClass, string>> = {
  "prd-children-table": "run_command",
  "prd-state": "run_command",
  generated: "run_command",
  "allowlist-union": "propose_edit",
  "duplicate-capture": "propose_prd_change",
  source: "none",
};

interface Target {
  ref?: string;
}

function header(target: Target): string {
  return `# Sidecar context packet: diagnose-branch${target.ref ? ` · ${target.ref}` : ""}\nBuilt by code from the repository's own records. No model wrote it.`;
}

function section(id: string, title: string, body: string, source: string, now: string): PacketSection {
  return { id, title, body, provenance: { source, generatedAt: now }, staleness: { state: "fresh" } };
}

function gap(id: string, title: string, why: string, source: string, now: string): PacketSection {
  return { id, title, body: `Not available: ${why}`, provenance: { source, generatedAt: now }, staleness: { state: "unknown", reason: why } };
}

/** The end of `text` within `max` characters, from a line start where one falls inside it. */
function tail(text: string, max: number): { text: string; cut: number } {
  if (text.length <= max) return { text, cut: 0 };
  const from = text.length - max;
  const line = text.indexOf("\n", from);
  const kept = line === -1 ? text.slice(from) : text.slice(line + 1);
  return { text: kept, cut: text.length - kept.length };
}

function argvText(argv: readonly string[]): string {
  return JSON.stringify(argv);
}

/**
 * A fix step as a `run_command` card runs it, or null when no card can:
 * a Sidecar command job starts `ndx` and `git` only (`startSidecarCommand`),
 * so `rex` runs as `ndx rex` and any other program is run by hand.
 */
export function cardArgv(argv: readonly string[]): string[] | null {
  const [program, ...rest] = argv;
  if (program === "ndx" || program === "git") return [...argv];
  if (program === "rex") return ["ndx", "rex", ...rest];
  return null;
}

/** One numbered fix step: the argv its card carries, or the command to run by hand. */
function stepLine(argv: readonly string[], i: number): string {
  const card = cardArgv(argv);
  return card
    ? `  ${i + 1}. ${argvText(card)}`
    : `  ${i + 1}. by hand, no card (Sidecar runs only ndx and git): \`${argv.join(" ")}\``;
}

function worktreeBody(read: BranchHealthRead): string {
  const { health } = read;
  return [
    `Workspace ${read.worktree.key}: ${read.worktree.path}`,
    `Branch: ${health.branch ?? "(detached HEAD)"} at ${health.head.slice(0, 12)}`,
    read.own
      ? "This is the session's own worktree: fix cards run here."
      : `This is not the session's worktree: fixes run in ${read.worktree.key}, so raise no fix card here; open that worktree's Sidecar to apply them.`,
  ].join("\n");
}

function baseBody(health: BranchHealth): string {
  const lines = [
    health.base
      ? `Base: ${health.base} (from ${health.baseSource ?? "unknown"})${health.baseNote ? `. ${health.baseNote}` : ""}`
      : "Base: none found (no PR base, upstream or origin default branch)",
    health.ahead === null || health.behind === null
      ? "Ahead/behind: not counted"
      : `Ahead ${health.ahead}, behind ${health.behind}`,
  ];
  if (health.stack.length === 0) {
    lines.push("Stack: not stacked; the base is the trunk or there is no base.");
  } else {
    lines.push(
      `Stack position: layer ${health.stack.length + 1} from the trunk: this branch → ${health.stack.map((l) => l.branch).join(" → ")} → trunk`,
      ...health.stack.map((l) => `- ${l.branch}: ${l.contained ? "contained" : "NOT contained: it has commits this branch lacks"}`),
    );
  }
  return lines.join("\n");
}

/** One conflict, its class and reason, and the card its fix goes on. */
function conflictLines(c: PredictedConflict, read: BranchHealthRead): string[] {
  const head = `- ${c.path} [${c.class}]: ${c.reason}`;
  if (c.class === "source" || !c.fix) {
    const others = c.otherWorktrees.length > 0
      ? ` The other worktrees whose branch also changed it: ${c.otherWorktrees.map((w) => `${w.branch} (${w.path})`).join(", ")}.`
      : "";
    return [head, `  Never auto-fixed, no card. Owner: worktree ${read.worktree.key} on ${read.health.branch ?? "its detached HEAD"} (${read.worktree.path}); a person there resolves it.${others}`];
  }
  if (!read.own) return [head, `  Fix runs in worktree ${read.worktree.key}: no card from this session.`];
  const card = CONFLICT_CARDS[c.class];
  if ("diff" in c.fix) {
    return [head, `  Card: ${card} {"path": ${JSON.stringify(c.path)}, "diff": the diff below}`, ...c.fix.diff.replace(/\n$/, "").split("\n").map((l) => `  ${l}`)];
  }
  if (card === "propose_prd_change") {
    const steps = c.fix.steps.map((argv, i) => `  ${i + 1}. ${argv.join(" ")}`);
    return [head, "  Card: propose_prd_change, one task to resolve the duplicate in the merge, its done-when these steps in order:", ...steps];
  }
  return [head, "  Cards: run_command, one per step in order, inside the merge:", ...c.fix.steps.map(stepLine)];
}

function conflictsBody(read: BranchHealthRead): string {
  const { health } = read;
  if (health.conflictsUnavailable) return `Not predicted: ${health.conflictsUnavailable}`;
  if (health.conflicts.length === 0) return `None: ${health.base ?? "the base"} merges into this branch cleanly.`;
  const merge = health.base ? argvText(["git", "merge", health.base]) : null;
  return [
    `${health.conflicts.length} file${health.conflicts.length === 1 ? "" : "s"} would conflict in \`git merge ${health.base}\`.`,
    ...(read.own && merge ? [`Every run_command fix runs inside that merge: raise run_command ${merge} first, and ${argvText(["git", "commit", "--no-edit"])} once every file is resolved.`] : []),
    ...health.conflicts.flatMap((c) => conflictLines(c, read)),
  ].join("\n");
}

function checkLines(check: FailingCheck, github: GithubFacts): string[] {
  const lines = [
    `- ${check.name} (${check.conclusion}) — class: ${CHECK_CLASS_LABELS[check.class]}${check.url ? ` · ${check.url}` : ""}`,
    `  Evidence: ${check.evidence}`,
    `  Failing on ${github.baseRefName || "the base"} too? Decide it only with github_read ${JSON.stringify({ kind: "check", ref: check.name, base: github.baseRefName })}.`,
  ];
  if (check.logTail === null) return [...lines, "  Log: none (the check left no Actions log)."];
  const kept = tail(check.logTail, BRANCH_LOG_TAIL_CHARS);
  return [
    ...lines,
    `  Log tail${kept.cut > 0 ? `, last ${kept.text.length} characters (${kept.cut} cut from the front)` : ""}:`,
    ...kept.text.split("\n").map((l) => `    ${l}`),
  ];
}

/** The PR and its failing checks, as the packet and a `github_read` of kind `pr` both state them. */
export function githubFactsBody(github: GithubFacts): string {
  return [
    `PR #${github.number} ${github.url} into ${github.baseRefName}${github.isCrossRepository ? " (from a fork)" : ""}`,
    `Mergeable: ${github.mergeable}, merge state ${github.mergeStateStatus}, review ${github.reviewDecision ?? "none"}`,
    `Checks: ${github.checks.total} total, ${github.checks.failing} failing, ${github.checks.pending} pending`,
    ...(github.failing.length === 0 ? ["No check is failing."] : github.failing.flatMap((check) => checkLines(check, github))),
  ].join("\n");
}

/**
 * Diagnose branch: the attached worktree's branch, base, PR, stack position
 * and containment, ahead/behind, each failing check with its class, evidence
 * and log tail, and each predicted conflict with its class and fix.
 */
export async function buildDiagnoseBranchPacket(
  sources: PacketSources,
  target: Target,
  now: string,
  signal?: AbortSignal,
): Promise<Packet> {
  const head = `${header(target)}\n\n${DIAGNOSE_BRANCH_INSTRUCTIONS}`;
  const done = (sections: PacketSection[]): Packet => assemblePacket({ lens: "diagnose-branch", cap: DIAGNOSE_BRANCH_CAP, header: head, sections });
  const source = "branch health (git, and gh under web.sidecarGithubReads)";
  if (!target.ref) return done([gap("worktree", "Worktree", "Diagnose branch needs a branch or worktree attached", source, now)]);
  const read = await sources.branchHealth(target.ref, signal);
  if (typeof read === "string") return done([gap("worktree", "Worktree", read, source, now)]);

  const { health } = read;
  const githubSource = read.githubReads ? "gh pr view, gh run view --log-failed" : "not read";
  const github = health.github
    ? section("checks", "PR and failing checks", githubFactsBody(health.github), githubSource, now)
    : gap(
        "checks",
        "PR and failing checks",
        `${health.githubReason ?? "GitHub was not read"} Ask for them with github_read ${JSON.stringify({ kind: "pr", ref: read.worktree.key })}${read.githubReads ? "" : ", which raises a network-read card"}.`,
        githubSource,
        now,
      );
  return done([
    section("worktree", "Worktree", worktreeBody(read), `git (${read.worktree.path})`, now),
    section("base", "Base and stack", baseBody(health), "git rev-list, merge-base --is-ancestor", now),
    section("conflicts", "Predicted conflicts", conflictsBody(read), "git merge-tree --write-tree", now),
    github,
  ]);
}
