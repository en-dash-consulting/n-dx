/**
 * `rex backfill-commit-attribution [dir]` — trailer coverage on the default branch.
 *
 * A read-only report. It writes nothing: not under the rex directory, not the
 * trailer cache `change-commits.ts` keeps, and it does not load the PRD at all.
 *
 * The name is historical. The command used to walk `git log` for `N-DX-Status`
 * trailers and write a `commits` array onto each item it named. Schema v2
 * retired that field — a commit's SHA is not its identity, so a change's
 * commits are computed from its trailers on demand — which left the backfill
 * writing state nothing reads. What survives is the question it was really
 * answering: how much of history can be attributed at all. That is what this
 * reports, before the trailer format freezes at 1.0.0.
 *
 * @module rex/cli/commands/backfill-commit-attribution
 */

import { computeTrailerCoverage } from "../../core/trailer-coverage.js";
import type {
  AuthorCoverage,
  GroupCoverage,
  MonthCoverage,
  TrailerCoverageReport,
} from "../../core/trailer-coverage.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";

export async function cmdBackfillCommitAttribution(
  dir: string,
  flags: Record<string, string> = {},
): Promise<void> {
  const report = await read(dir, ref(flags));

  if (isJson(flags)) {
    result(JSON.stringify(report, null, 2));
    return;
  }
  result(renderText(report));
}

/**
 * Git failures here are the operator's problem to fix — a branch that does not
 * exist, a shallow CI checkout — so they surface as a CLIError with the cause
 * named rather than a stack trace. The predecessor caught them and returned
 * normally, which turned an unreadable log into a silent success.
 */
async function read(dir: string, refName: string | undefined): Promise<TrailerCoverageReport> {
  try {
    return await computeTrailerCoverage({ repoDir: dir, ref: refName });
  } catch (err) {
    throw new CLIError(
      `Could not read git history: ${(err as Error).message}`,
      "Run this inside a git repository with full history; pass --ref=<branch> to read another branch.",
    );
  }
}

/** `--json` and `--format=json` both select machine-readable output. */
function isJson(flags: Record<string, string>): boolean {
  return flags.json === "true" || flags.format === "json";
}

function ref(flags: Record<string, string>): string | undefined {
  const raw = flags.ref;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "true") {
    throw new CLIError(
      "--ref needs a value.",
      "Write it as --ref=<branch>; the space-separated form is not supported.",
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderText(report: TrailerCoverageReport): string {
  const { totals } = report;
  const lines: string[] = [
    `Trailer coverage — ${report.ref} @ ${report.tip.slice(0, 8)}`,
    "",
  ];

  if (totals.commits === 0) {
    lines.push("No commits on this branch.");
    return lines.join("\n");
  }

  lines.push(
    `  ${totals.commits} commits · ${totals.covered} carry an item trailer (${percent(totals.covered, totals.commits)}) · ${totals.uncovered} do not`,
  );
  if (totals.uncoveredMerges > 0) {
    lines.push(`  ${totals.uncoveredMerges} of the uncovered are merge commits, which carry no trailer by construction.`);
  }
  if (totals.writtenOutsideTrailerBlock > 0) {
    lines.push(
      `  ${totals.writtenOutsideTrailerBlock} covered commits write the trailer outside the message's final`,
      "  paragraph, so git's own trailer parser — the one attribution reads — does not see them.",
    );
  }

  section(lines, "By author", report.byAuthor, (a: AuthorCoverage) =>
    `${a.author} <${a.authorEmail}>`,
  );
  section(lines, "By month", report.byMonth, (m: MonthCoverage) => m.month);

  return lines.join("\n");
}

/** One row per group: how many of its commits carry no trailer. */
function section<T extends GroupCoverage>(
  lines: string[],
  heading: string,
  groups: T[],
  label: (group: T) => string,
): void {
  if (groups.length === 0) return;
  lines.push("", heading);
  const width = Math.max(...groups.map((g) => label(g).length));
  for (const group of groups) {
    lines.push(
      `  ${label(group).padEnd(width)}  ${group.uncovered} of ${group.commits} uncovered (${percent(group.uncovered, group.commits)})`,
    );
  }
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`;
}
