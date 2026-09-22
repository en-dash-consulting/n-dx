/**
 * `rex claim` — see and free cross-worktree task claims.
 *
 * Claims live in `<git common dir>/ndx/claims.json` (see `store/claims.ts`),
 * which is inside `.git/` and therefore invisible to every ordinary tool. Until
 * now the only ways to look at one were to read that file by hand or to open
 * the dashboard's `GET /api/rex/claims`, and there was no way at all to free a
 * claim short of deleting the file.
 *
 * Two things made that a problem rather than an inconvenience. A claim held on
 * purpose — the completion gate refusing a task because its work is still
 * uncommitted — outlives the run that took it, so it cannot be waited out. And
 * a claim whose process died on another machine cannot be pruned by the pid
 * check, because `kill(pid, 0)` means nothing across hosts.
 *
 * `list` answers who holds what. `release` frees one, refusing while the
 * holder still looks alive unless `--force` says otherwise.
 *
 * @module rex/cli/commands/claim
 */

import { join } from "node:path";
import { CLIError, result } from "@n-dx/llm-client";
import {
  openClaimsStore,
  resolveClaimHolder,
  defaultIsPidAlive,
  type TaskClaim,
} from "../../store/claims.js";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";

/** One claim as `list` reports it, with everything the file does not store directly. */
export interface ClaimReport {
  taskId: string;
  /** PRD title, or null when the task is not in this worktree's tree. */
  title: string | null;
  worktreeRoot: string;
  pid: number;
  host: string;
  /** Whether `kill(pid, 0)` finds the holder. Meaningless across hosts. */
  pidAlive: boolean;
  claimedAt: string;
  expiresAt: string;
  /** Why the claim is held past its holder's exit, or null while it is running. */
  reason: string | null;
  /** True when this claim belongs to the worktree the command ran in. */
  mine: boolean;
}

/** What a claim is doing, in one word: the held reason, or "running". */
export function claimState(claim: Pick<TaskClaim, "reason">): string {
  return claim.reason ?? "running";
}

/**
 * Join live claims to PRD titles and this worktree's identity.
 *
 * A title is best-effort: claims are cross-worktree but the PRD tree read here
 * is this worktree's, so a task created on a branch checked out somewhere else
 * has no title to show. That is worth reporting as "—" rather than failing the
 * listing, because the claim itself is still the thing the operator came for.
 */
export async function collectClaims(dir: string): Promise<ClaimReport[]> {
  const store = openClaimsStore(dir);
  const holder = resolveClaimHolder(dir);
  const claims = await store.readClaims();

  const titles = new Map<string, string>();
  if (claims.length > 0) {
    try {
      const prd = await resolveStore(join(dir, REX_DIR));
      for (const claim of claims) {
        const item = await prd.getItem(claim.taskId);
        if (item) titles.set(claim.taskId, item.title);
      }
    } catch {
      // No readable PRD here — the claims still list, without titles.
    }
  }

  return claims
    .map((claim) => ({
      taskId: claim.taskId,
      title: titles.get(claim.taskId) ?? null,
      worktreeRoot: claim.worktreeRoot,
      pid: claim.pid,
      host: claim.host,
      pidAlive: defaultIsPidAlive(claim.pid),
      claimedAt: claim.claimedAt,
      expiresAt: claim.expiresAt,
      reason: claim.reason ?? null,
      mine: claim.worktreeRoot === holder.worktreeRoot,
    }))
    .sort((a, b) => a.taskId.localeCompare(b.taskId));
}

/** `2026-09-22T14:03:00.000Z` → `2026-09-22 14:03`, or the raw value if unparseable. */
function shortTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

/** The human listing. One block per claim — a table would not fit a worktree path. */
export function formatClaims(reports: ClaimReport[]): string[] {
  if (reports.length === 0) {
    return ["No task claims are held in this repository."];
  }

  const lines: string[] = [
    `${reports.length} task claim${reports.length === 1 ? "" : "s"}:`,
    "",
  ];
  for (const r of reports) {
    lines.push(`  ${r.taskId}${r.mine ? "  (this worktree)" : ""}`);
    lines.push(`    task:     ${r.title ?? "— (not in this worktree's PRD)"}`);
    lines.push(`    worktree: ${r.worktreeRoot}`);
    lines.push(`    holder:   pid ${r.pid} on ${r.host} — ${r.pidAlive ? "alive" : "not running"}`);
    lines.push(`    state:    ${claimState({ reason: r.reason ?? undefined })}`);
    lines.push(`    expires:  ${shortTime(r.expiresAt)} (claimed ${shortTime(r.claimedAt)})`);
    lines.push("");
  }
  return lines;
}

/**
 * Whether `release` may free this claim without `--force`.
 *
 * Two cases are safe. A dead holder means nothing is working the task — the
 * store would prune it at expiry anyway, and this only makes that immediate.
 * A held claim is *expected* to have a dead pid: it was kept deliberately so
 * the work would not be redone, and freeing it is the documented way to say
 * the work has been dealt with.
 *
 * A live pid with no held reason is a run in progress. Freeing that invites
 * exactly the duplicate work claims exist to prevent, so it takes `--force`.
 */
export function releasableWithoutForce(claim: Pick<TaskClaim, "reason" | "pid">): boolean {
  return Boolean(claim.reason) || !defaultIsPidAlive(claim.pid);
}

interface ReleaseOutcome {
  taskId: string;
  released: boolean;
  /** Why it was not released, for the operator and for `--format=json`. */
  detail?: string;
}

async function releaseOne(
  dir: string,
  taskId: string,
  force: boolean,
): Promise<ReleaseOutcome> {
  const store = openClaimsStore(dir);
  const holder = resolveClaimHolder(dir);
  const claims = await store.readClaims();
  const claim = claims.find((c) => c.taskId === taskId);

  if (!claim) {
    return { taskId, released: false, detail: "no live claim on that task" };
  }
  if (!force && !releasableWithoutForce(claim)) {
    return {
      taskId,
      released: false,
      detail:
        `a run is still working it — pid ${claim.pid} is alive in ${claim.worktreeRoot}. ` +
        `Re-run with --force if that process is not really working this task.`,
    };
  }
  // `force` also crosses the worktree boundary: the store's own release is
  // scoped to the caller's worktree, which is right for a run cleaning up
  // after itself and wrong for an operator clearing a stuck claim from
  // wherever they happen to be standing.
  const released = await store.release(taskId, holder, { force });
  return released
    ? { taskId, released: true }
    : { taskId, released: false, detail: `held by another worktree (${claim.worktreeRoot}) — use --force` };
}

export async function cmdClaim(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const subcommand = positional[0];
  const json = flags.format === "json";
  const force = flags.force === "true";

  if (!subcommand || flags.help === "true") {
    result(`rex claim — inspect and free cross-worktree task claims

Usage:
  rex claim list [dir]                  Show every live claim in this repository
  rex claim release <taskId> [dir]      Free one task's claim
  rex claim release --all [dir]         Free every claim this worktree holds

Options:
  --force            Release even while the holding process is alive, or when
                     the claim belongs to another worktree
  --format=json      Machine-readable output

A claim is held deliberately when a run refused to complete its task because
the work was still uncommitted. Releasing it says that work has been dealt
with; until then another worktree will pass the task over.`);
    return;
  }

  if (subcommand === "list") {
    const reports = await collectClaims(dir);
    if (json) {
      result(JSON.stringify({ claims: reports }, null, 2));
      return;
    }
    for (const line of formatClaims(reports)) result(line);
    return;
  }

  if (subcommand !== "release") {
    throw new CLIError(
      `Unknown claim subcommand: ${subcommand}`,
      "Use 'rex claim list' or 'rex claim release <taskId>'.",
    );
  }

  // ── release ──
  if (flags.all === "true") {
    const holder = resolveClaimHolder(dir);
    const mine = (await collectClaims(dir)).filter((c) => c.mine);
    const outcomes: ReleaseOutcome[] = [];
    for (const claim of mine) {
      outcomes.push(await releaseOne(dir, claim.taskId, force));
    }
    if (json) {
      result(JSON.stringify({ worktreeRoot: holder.worktreeRoot, released: outcomes }, null, 2));
      return;
    }
    const freed = outcomes.filter((o) => o.released);
    if (outcomes.length === 0) {
      result(`No claims are held by this worktree (${holder.worktreeRoot}).`);
      return;
    }
    result(`Released ${freed.length} of ${outcomes.length} claim(s) held by ${holder.worktreeRoot}.`);
    for (const o of outcomes) {
      result(o.released ? `  freed    ${o.taskId}` : `  kept     ${o.taskId} — ${o.detail}`);
    }
    return;
  }

  const taskId = positional[1];
  if (!taskId) {
    throw new CLIError(
      "rex claim release needs a task id.",
      "Run 'rex claim list' to see what is held, or pass --all to free this worktree's claims.",
    );
  }

  const outcome = await releaseOne(dir, taskId, force);
  if (json) {
    result(JSON.stringify(outcome, null, 2));
    if (!outcome.released) process.exitCode = 1;
    return;
  }
  if (outcome.released) {
    result(`Released the claim on ${taskId}.`);
    return;
  }
  throw new CLIError(
    `Did not release the claim on ${taskId}: ${outcome.detail}`,
    "Run 'rex claim list' to see the current holders.",
  );
}
