/**
 * The interactive half of the PRD tree's slug-rule gate: offer to run
 * `rex migrate-slugs`, and then stop.
 *
 * The gate itself refuses a tree this build would re-slug — see
 * `assertPrdTreeConformant` in `./commands/run.ts`. Until now a refusal
 * dead-ended the operator with an instruction to go and run the migration by
 * hand. This closes that loop without closing the one thing the migration
 * exists to provide.
 *
 * **Why the offer stops the run instead of continuing into the task.** On a
 * non-conformant tree `migrate-slugs` is not a no-op: it rewrites every path
 * that does not match the running rule, which can be the whole tree. The
 * command's own header says why it exists — it performs that rename
 * deliberately, in one reviewable commit, instead of letting the next ordinary
 * save produce a surprise mass diff. Running it inside a task run and carrying
 * on turns it straight back into that surprise diff: the rename lands in
 * whatever commit the task makes next, under a message about something else.
 * That is the 2026-09-17 incident — a pull request merging 1,570 re-slugged
 * files through green CI — with the human step deleted rather than automated.
 * Stopping after the migration keeps the rename in its own commit, which is the
 * property the command was built to provide, and still removes the manual step.
 *
 * **Why an autonomous run is never offered it.** An unattended run has nobody
 * to look at the diff before it is committed, and that review is the entire
 * safeguard. So `--auto`, `--loop`, `--epic-by-epic`, `--yes`, a non-terminal
 * stdin and CI all refuse exactly as before — and say which of those withheld
 * the offer, rather than silently behaving differently from an interactive run.
 * `--dry-run` is withheld too, even on a terminal, because a dry run promises
 * not to touch the working tree and accepting would rewrite all of it.
 *
 * **Why not in the store guard.** `assertSlugRuleWritable` throws from inside
 * `writeFolderTree`, which runs holding the PRD lock, and `migrate-slugs` needs
 * that same lock — recovering there would deadlock. The gates are the place:
 * they run before the claim and outside the lock, which is what lets their
 * refusal promise that nothing has been claimed or written.
 *
 * @see packages/rex/src/cli/commands/migrate-slugs.ts — the command this spawns.
 * @see packages/rex/src/store/slug-rule-guard.ts — `migratable`, the direction bound.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { exec } from "../process/exec.js";
import { resolveLauncherCli } from "../process/agent-mcp-config.js";

/**
 * How long the migration is given before it is treated as hung.
 *
 * Generous because the command snapshots the tree first and then rewrites it:
 * on the largest tree we have measured (405 items) the whole pass is seconds,
 * but a cold filesystem on Windows CI is a different machine entirely. A
 * timeout here is reported as a failure, never as a success.
 */
const MIGRATION_TIMEOUT_MS = 10 * 60_000;

/** Why an offer that could have been made was not. */
export type OfferWithheldReason =
  | "dry-run"
  | "autonomous"
  | "assume-yes"
  | "ci"
  | "not-a-terminal"
  | "no-rex-cli";

/** What the gate should do once the offer has been resolved. */
export type SlugMigrationOffer =
  /** Not a refusal a migration fixes. Rethrow unchanged, with no mention of an offer. */
  | { readonly outcome: "no-offer" }
  /** A migration would fix it, but this run must not be asked. Rethrow, appending `note`. */
  | { readonly outcome: "withheld"; readonly reason: OfferWithheldReason; readonly note: string }
  /** The operator said no. Rethrow unchanged — they have read the refusal. */
  | { readonly outcome: "declined" }
  /** The migration ran. Print `report` and stop; do not execute the task. */
  | { readonly outcome: "migrated"; readonly report: string };

/** A resolved way to invoke the rex CLI. */
export interface RexCliCommand {
  /** Executable to spawn. Always the current Node binary. */
  readonly command: string;
  /** Arguments that precede the `migrate-slugs` subcommand. */
  readonly args: readonly string[];
  /** How to name this invocation to the operator. */
  readonly label: string;
}

/**
 * Locate a rex CLI to run the migration with.
 *
 * Two rungs, in the order that keeps the migration and the run on the *same*
 * build. The launcher CLI first: `packages/core/cli.js` exports `NDX_CLI_PATH`
 * and {@link resolveLauncherCli} only accepts it after confirming the install it
 * names resolves back to this hench, so `ndx rex migrate-slugs` is known to be
 * the rex whose slug rule this gate is enforcing. Failing that — a standalone
 * `hench run`, or a nested invocation whose inherited path names a foreign
 * install — rex is resolved from hench's own module graph, which is the same
 * build by construction.
 *
 * A build that finds neither withholds the offer rather than guessing. Running
 * an unrelated rex against this tree is how the ping-pong rename starts.
 */
export function resolveRexCli(env: NodeJS.ProcessEnv = process.env): RexCliCommand | undefined {
  const launcher = resolveLauncherCli(env);
  if (launcher.usable) {
    return {
      command: process.execPath,
      args: [launcher.cliPath, "rex"],
      label: "ndx rex migrate-slugs",
    };
  }

  // Monorepo-relative first, then the `./dist/*` subpath export, mirroring
  // `henchRootReachableFrom` in process/agent-mcp-config.ts. This file sits at
  // `<hench>/{src,dist}/cli/`, so three levels up is `packages/`.
  const here = fileURLToPath(import.meta.url);
  const mono = resolve(dirname(here), "../../..", "rex", "dist", "cli", "index.js");
  if (existsSync(mono)) {
    return { command: process.execPath, args: [mono], label: "rex migrate-slugs" };
  }
  try {
    const resolved = createRequire(here).resolve("@n-dx/rex/dist/cli/index.js");
    return { command: process.execPath, args: [resolved], label: "rex migrate-slugs" };
  } catch {
    return undefined;
  }
}

/** Everything the offer decision depends on, gathered by the caller. */
export interface OfferConditions {
  /** `TreeConformanceRefusal.migratable` — false for a tree on a *newer* rule. */
  readonly migratable: boolean;
  /** `--dry-run`. Optional so callers that predate it read as a real run. */
  readonly dryRun?: boolean;
  /** `--auto`, `--loop` or `--epic-by-epic`. */
  readonly autonomous: boolean;
  /** `--yes`. */
  readonly assumeYes: boolean;
  readonly isTTY: boolean;
  readonly ci: boolean;
  readonly cli: RexCliCommand | undefined;
}

/**
 * Whether this run may be offered the migration, and if not, what to tell the
 * operator.
 *
 * Split out from {@link offerSlugMigration} so the policy can be tested without
 * a tree, a terminal or a subprocess — it is the part that decides whether an
 * unattended run can rewrite a repository, and it should be readable on its own.
 */
export function decideOffer(
  conditions: OfferConditions,
): { readonly offer: true } | Exclude<SlugMigrationOffer, { outcome: "migrated" } | { outcome: "declined" }> {
  // Checked first and answered silently. `migrate-slugs` refuses this tree too
  // (`assertSlugRuleAdoptable`), and the refusal the operator is about to read
  // already tells them to upgrade rex and *not* to run the migration. Adding
  // "an offer was withheld" would contradict it.
  if (!conditions.migratable) return { outcome: "no-offer" };

  // Ahead of every other withholding reason: a dry run promises not to touch
  // the working tree, and accepting the offer would rewrite all of it. That
  // holds on an interactive terminal too, where every later check would pass.
  if (conditions.dryRun) {
    return {
      outcome: "withheld",
      reason: "dry-run",
      note:
        "This is a dry run (--dry-run), which never writes, so it was not offered the migration: " +
        "accepting would rewrite the tree. Re-run without --dry-run to be asked, or run the " +
        "migration yourself on the default branch.",
    };
  }

  if (conditions.autonomous) {
    return {
      outcome: "withheld",
      reason: "autonomous",
      note:
        "This run is autonomous (--auto, --loop or --epic-by-epic), so it was not offered the " +
        "migration: a whole-tree rename has to be reviewed before it is committed, and an " +
        "unattended run has nobody to review it. Run the migration yourself on the default branch.",
    };
  }
  if (conditions.ci) {
    return {
      outcome: "withheld",
      reason: "ci",
      note:
        "CI is set, so this run was not offered the migration: a whole-tree rename has to be " +
        "reviewed before it is committed, and CI has nobody to review it. Run the migration on " +
        "the default branch instead.",
    };
  }
  if (!conditions.isTTY) {
    return {
      outcome: "withheld",
      reason: "not-a-terminal",
      note:
        "stdin is not a terminal, so this run was not offered the migration — there is nobody " +
        "to prompt. Run it from a terminal, or run the migration yourself on the default branch.",
    };
  }
  // --yes exists to skip prompts, not to consent to one that was never asked.
  // A whole-tree rename is the last thing to assume a yes for.
  if (conditions.assumeYes) {
    return {
      outcome: "withheld",
      reason: "assume-yes",
      note:
        "--yes suppresses prompts, and a whole-tree rename is not something to assume yes to, " +
        "so this run was not offered the migration. Re-run without --yes to be asked, or run " +
        "the migration yourself on the default branch.",
    };
  }
  if (!conditions.cli) {
    return {
      outcome: "withheld",
      reason: "no-rex-cli",
      note:
        "This build could not locate the rex CLI it would run the migration with, so no offer " +
        "was made rather than risk running a different rex against this tree. Run " +
        "'rex migrate-slugs' on the default branch.",
    };
  }
  return { offer: true };
}

/** The offending paths a migration would rename, and how many there are. */
export interface MigrationPreview {
  /** Paths relative to the tree root, capped for display. */
  readonly paths: readonly string[];
  /** Total offenders, which may exceed `paths.length`. */
  readonly total: number;
}

/** How many offending paths the preview names before it stops. */
const PREVIEW_LIMIT = 10;

/**
 * Describe the rename the operator is being asked to approve.
 *
 * `migrate-slugs` has no `--dry-run`, but the refusal already carries the scan
 * that produced it, so the preview is built from that rather than by running
 * anything. The marker-only refusal carries no paths — a marker naming another
 * rule means every path in the tree is suspect, and the text says so instead of
 * naming none.
 */
export function formatMigrationPreview(
  preview: MigrationPreview,
  label: string,
): string {
  const scope =
    preview.total === 0
      ? "  every path in the tree (its marker names a different rule, so none of them can be trusted)"
      : preview.paths.map((p) => `  ${p}`).join("\n") +
        (preview.total > preview.paths.length
          ? `\n  …and ${preview.total - preview.paths.length} more.`
          : "");

  return (
    `\n'${label}' would rename:\n${scope}\n\n` +
    `It snapshots the tree first, so 'rex restore' can undo it. Nothing else in this run has\n` +
    `been claimed or written yet, and the run will stop after the migration rather than\n` +
    `continue into the task — so the rename lands in its own commit for you to review,\n` +
    `which is the whole reason the command exists.\n`
  );
}

/** What `rex migrate-slugs --format=json` reports. */
export interface MigrationSummary {
  readonly entriesRenamed: number;
  readonly entriesUnchanged: number;
  readonly itemsVerified: number;
  readonly lossless: boolean;
  readonly slugRuleRecorded: boolean;
}

/** Thrown when the spawned migration did not complete successfully. */
export class SlugMigrationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlugMigrationFailedError";
  }
}

function parseMigrationSummary(stdout: string): MigrationSummary | undefined {
  // The command prints one JSON object under --format=json, but a notice on
  // stdout from a library underneath it would sit in front. Skip to the first
  // brace rather than assuming the buffer is pure JSON; a notice that itself
  // contains a brace fails the parse, which reports as unconfirmed, not success.
  const start = stdout.indexOf("{");
  if (start === -1) return undefined;
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const o = parsed as Record<string, unknown>;
    if (typeof o.entriesRenamed !== "number") return undefined;
    return {
      entriesRenamed: o.entriesRenamed,
      entriesUnchanged: typeof o.entriesUnchanged === "number" ? o.entriesUnchanged : 0,
      itemsVerified: typeof o.itemsVerified === "number" ? o.itemsVerified : 0,
      lossless: o.lossless === true,
      slugRuleRecorded: o.slugRuleRecorded === true,
    };
  } catch {
    return undefined;
  }
}

/**
 * Spawn `rex migrate-slugs` and report what it did.
 *
 * Spawned rather than imported. `cmdMigrateSlugs` is a CLI command that writes
 * to stdout and throws rex's own error type, and hench's rex gateway is
 * explicitly not a route for PRD *mutations* — an import would put the
 * monorepo's single largest write behind a re-export declared to carry none.
 * A child process also gives the migration its own exit code, which is the
 * thing this function has to be able to distinguish.
 *
 * @throws {SlugMigrationFailedError} When the command did not run, exited
 *   non-zero, or produced output that cannot be read as a successful migration.
 */
export async function runSlugMigration(
  dir: string,
  cli: RexCliCommand,
  timeoutMs: number = MIGRATION_TIMEOUT_MS,
): Promise<MigrationSummary> {
  const res = await exec(
    cli.command,
    [...cli.args, "migrate-slugs", "--format=json", dir],
    { cwd: dir, timeout: timeoutMs },
  );

  if (!res.launched) {
    throw new SlugMigrationFailedError(
      `Could not start '${cli.label}': ${res.error?.message ?? "the command never ran"}.`,
    );
  }
  if (res.exitCode !== 0) {
    const detail = (res.stderr.trim() || res.stdout.trim() || "no output").slice(0, 2000);
    throw new SlugMigrationFailedError(
      res.exitCode === null
        ? `'${cli.label}' was killed before it finished (timeout ${timeoutMs}ms). ` +
          `The tree may be part-migrated — check 'git status' and 'rex restore'.\n${detail}`
        : `'${cli.label}' exited ${res.exitCode}:\n${detail}`,
    );
  }

  const summary = parseMigrationSummary(res.stdout);
  if (!summary) {
    throw new SlugMigrationFailedError(
      `'${cli.label}' exited 0 but did not report what it did, so the migration cannot be ` +
        `confirmed. Check 'git status' before doing anything else.\n${res.stdout.trim().slice(0, 2000)}`,
    );
  }
  // `migrate-slugs` refuses a lossy migration itself and exits non-zero, so a
  // zero exit reporting lossless:false is a contradiction rather than a result.
  if (!summary.lossless) {
    throw new SlugMigrationFailedError(
      `'${cli.label}' reported that the migration was not lossless. Run 'rex restore' to undo it.`,
    );
  }
  return summary;
}

/**
 * What to print after a migration, and what the operator has to do next.
 *
 * States the counts rather than re-listing the paths: the rename is now in the
 * working tree, so `git status` is the authoritative list and the one the
 * operator will act on. The instruction to commit before re-running is the
 * point of the whole feature — the run stopped precisely so that this rename
 * gets a commit of its own.
 */
export function formatMigrationReport(summary: MigrationSummary, dir: string): string {
  const renamed =
    summary.entriesRenamed === 1 ? "1 entry" : `${summary.entriesRenamed} entries`;
  const treePath = join(".rex", "prd_tree");

  return (
    `\nMigrated the PRD tree: ${renamed} renamed, ${summary.entriesUnchanged} unchanged, ` +
    `${summary.itemsVerified} items verified identical.` +
    (summary.slugRuleRecorded ? "\nRecorded the slug-rule marker." : "") +
    `\n\nThe run stopped here rather than continuing into the task, so the rename gets a commit\n` +
    `of its own instead of landing inside one about something else.\n\n` +
    `  git -C ${dir} status ${treePath}\n` +
    `  git -C ${dir} diff -- ${treePath}\n\n` +
    `Review it, commit it, then start the run again. 'rex restore' undoes the migration if the\n` +
    `diff is not what you expected.\n`
  );
}

/** Ask a yes/no question on the terminal. Anything but y/yes is a no. */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((res) => {
    rl.question(question, (a) => {
      rl.close();
      res(a.trim().toLowerCase());
    });
  });
  return answer === "y" || answer === "yes";
}

/** Whether this process is running under a CI system. */
export function runningInCI(env: NodeJS.ProcessEnv = process.env): boolean {
  const ci = env["CI"];
  if (ci === undefined || ci === "") return false;
  return ci !== "0" && ci.toLowerCase() !== "false";
}

/** Seams, so the accept/decline paths are testable without a terminal. */
export interface OfferDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly isTTY?: boolean;
  readonly prompt?: (question: string) => Promise<boolean>;
  readonly write?: (text: string) => void;
  readonly resolveCli?: (env: NodeJS.ProcessEnv) => RexCliCommand | undefined;
  readonly migrate?: (dir: string, cli: RexCliCommand) => Promise<MigrationSummary>;
}

/**
 * Offer to migrate the tree the gate just refused, and report what to do next.
 *
 * Never throws for a declined or withheld offer — those are ordinary outcomes
 * the gate reports by rethrowing its own refusal. It throws only when a
 * migration the operator *accepted* did not complete, because a half-finished
 * rename is the one state the operator has to be told about loudly.
 *
 * @param dir     The project directory, which is what `migrate-slugs` takes.
 * @param refusal The gate's refusal — its `migratable` flag bounds the offer
 *   and its `mismatches` supply the preview.
 * @throws {SlugMigrationFailedError} When an accepted migration failed.
 */
export async function offerSlugMigration(
  dir: string,
  refusal: {
    readonly migratable: boolean;
    readonly mismatches: readonly { readonly parentDir: string; readonly found: string }[];
  },
  run: { readonly dryRun?: boolean; readonly autonomous: boolean; readonly assumeYes: boolean },
  deps: OfferDeps = {},
): Promise<SlugMigrationOffer> {
  const env = deps.env ?? process.env;
  const resolveCli = deps.resolveCli ?? resolveRexCli;
  const write = deps.write ?? ((text: string) => process.stdout.write(text));

  const decision = decideOffer({
    migratable: refusal.migratable,
    dryRun: run.dryRun,
    autonomous: run.autonomous,
    assumeYes: run.assumeYes,
    isTTY: deps.isTTY ?? Boolean(process.stdin.isTTY),
    ci: runningInCI(env),
    cli: resolveCli(env),
  });
  if (!("offer" in decision)) return decision;

  // Re-resolved rather than threaded out of `decideOffer`, whose return type
  // deliberately carries no command — the decision is policy, this is plumbing.
  const cli = resolveCli(env);
  /* c8 ignore next */
  if (!cli) return { outcome: "withheld", reason: "no-rex-cli", note: "" };

  write(
    formatMigrationPreview(
      {
        paths: refusal.mismatches
          .slice(0, PREVIEW_LIMIT)
          .map((m) => join(m.parentDir, m.found)),
        total: refusal.mismatches.length,
      },
      cli.label,
    ),
  );

  const prompt = deps.prompt ?? promptYesNo;
  const accepted = await prompt(`Run '${cli.label}' now and stop the run? [y/N] `);
  if (!accepted) return { outcome: "declined" };

  const migrate = deps.migrate ?? ((d: string, c: RexCliCommand) => runSlugMigration(d, c));
  const summary = await migrate(dir, cli);
  return { outcome: "migrated", report: formatMigrationReport(summary, dir) };
}
