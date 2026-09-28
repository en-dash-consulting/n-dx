/**
 * Declared effects for the orchestrator commands that spend real time and money.
 *
 * Each entry says, once, what a command reads, what it writes, which phases
 * call an LLM, what network it touches and roughly how long it takes. The
 * declaration is the source of the terminal preflight banner printed before
 * `ndx analyze`, `ndx plan` and `ndx recommend`, and is the same object the
 * dashboard's command manifest will serve — so the two surfaces can never
 * disagree about what a command is about to do.
 *
 * This module is pure data plus pure formatting. It reads no files, imports
 * nothing, and holds no state, which keeps it inside the orchestration tier's
 * spawn-only rule (see CLAUDE.md, "Tier boundary crossing") and makes the gate
 * decision directly unit-testable without a terminal.
 *
 * **The map is deliberately partial.** Only the three commands that pause are
 * declared today; {@link getCommandEffects} answers `null` for everything else
 * and callers must treat that as "no banner", not as an error. The remaining
 * commands are declared by the sibling task that also regenerates
 * `docs/cli-ui-gap.md` and serves the manifest over `/api/commands/manifest`.
 *
 * @module core/command-effects
 */

/**
 * @typedef {Object} WriteEffect
 * @property {string} path - Path written, relative to the project root.
 * @property {string} what - What lands there, in the user's terms.
 * @property {boolean} [conditional] - Only written under the flag named in `when`.
 * @property {string} [when] - The flag that turns this write on.
 */

/**
 * @typedef {Object} LLMPhase
 * @property {string} phase - Phase name, as the command prints it.
 * @property {string} purpose - Why the phase needs a model.
 * @property {string} calls - Rough call count, as a range.
 */

/**
 * @typedef {Object} CommandEffects
 * @property {string} command - Orchestrator command name.
 * @property {string} summary - One line: what running this does.
 * @property {string[]} reads - Paths and inputs consulted.
 * @property {WriteEffect[]} writes - Everything the command can write.
 * @property {LLMPhase[]} llm - Phases that call a model; empty means read-only of your API budget.
 * @property {"none"|"llm-provider"} network - What the command talks to.
 * @property {string} duration - Rough wall-clock, for expectation-setting only.
 * @property {string} next - The command to run afterwards.
 */

/** Flags that turn every LLM phase off, making the command deterministic. */
const NO_LLM_FLAGS = new Set(["--no-llm", "--fast"]);

/** Flags that suppress the banner outright: the caller has already decided. */
const BANNER_SUPPRESSING_FLAGS = new Set([
  "--yes", "-y",
  "--quiet", "-q",
  "--json", "--format=json",
]);

/** @type {Record<string, CommandEffects>} */
export const COMMAND_EFFECTS = {
  analyze: {
    command: "analyze",
    summary: "Scan the codebase and rewrite the SourceVision analysis.",
    reads: [
      "every tracked source file under the project",
      ".sourcevision/manifest.json (the previous run)",
    ],
    writes: [
      { path: ".sourcevision/", what: "inventory, import graph, zones, CONTEXT.md, llms.txt" },
    ],
    llm: [
      { phase: "zones", purpose: "name and describe each detected zone", calls: "1-2 per escalated zone" },
      { phase: "findings", purpose: "turn structural facts into readable findings", calls: "1-3" },
    ],
    network: "llm-provider",
    duration: "under a minute on a small repo; several minutes with --deep",
    next: "ndx plan",
  },

  plan: {
    command: "plan",
    summary: "Re-analyze, then propose PRD items from what the analysis found.",
    reads: [
      "every tracked source file under the project",
      ".sourcevision/ (refreshed first)",
      ".rex/prd_tree/ (to avoid proposing what already exists)",
    ],
    writes: [
      { path: ".sourcevision/", what: "inventory, import graph, zones, CONTEXT.md, llms.txt" },
      { path: ".rex/pending-proposals.json", what: "the proposals, cached for a later --accept" },
      { path: ".rex/prd_tree/", what: "accepted proposals as PRD items", conditional: true, when: "--accept" },
    ],
    llm: [
      { phase: "zones", purpose: "name and describe each detected zone", calls: "1-2 per escalated zone" },
      { phase: "proposals", purpose: "draft PRD items from findings and scans", calls: "1 per proposal batch" },
      { phase: "decomposition", purpose: "split proposals that are too large for one task", calls: "0-1 per oversized proposal" },
    ],
    network: "llm-provider",
    duration: "a few minutes — it runs a full analysis first",
    next: "ndx status",
  },

  recommend: {
    command: "recommend",
    summary: "Group SourceVision findings into recommendations you can accept.",
    reads: [
      ".sourcevision/ (findings from the last analysis)",
      ".rex/prd_tree/ and .rex/acknowledged-findings.json",
    ],
    writes: [
      { path: ".rex/acknowledged-findings.json", what: "acknowledgements", conditional: true, when: "--acknowledge" },
      { path: ".rex/prd_tree/", what: "accepted recommendations as PRD items", conditional: true, when: "--accept" },
    ],
    // Recommendations are grouped from findings deterministically — no model is
    // consulted. Saying so is the point of the banner: this one is free.
    llm: [],
    network: "none",
    duration: "seconds",
    next: "ndx work",
  },
};

/** The declared effects of `command`, or `null` when it has none yet. */
export function getCommandEffects(command) {
  return COMMAND_EFFECTS[command] ?? null;
}

/**
 * The effects of `command` as they apply to *this* invocation.
 *
 * Today that means dropping the LLM phases under `--no-llm` / `--fast`: a
 * banner that advertises model calls a run will not make is worse than no
 * banner, because it teaches the reader to stop believing it.
 *
 * @param {string} command
 * @param {string[]} flags
 * @returns {CommandEffects|null}
 */
export function resolveCommandEffects(command, flags = []) {
  const base = getCommandEffects(command);
  if (!base) return null;
  if (!flags.some((f) => NO_LLM_FLAGS.has(f))) return base;
  return { ...base, llm: [], network: "none" };
}

/**
 * Whether to print the preflight banner for this invocation.
 *
 * Precedence, highest first:
 *   1. A flag that already answers the question — `--yes`, `--quiet`,
 *      `--format=json`. The caller has decided or is machine-reading.
 *   2. `NDX_PREFLIGHT=always|never` (also `1`/`0`), for an operator who pipes
 *      output but still wants the banner, and for tests that have no terminal.
 *   3. `CI` — an unattended runner has nobody to pause for.
 *   4. Whether stdout is a terminal. A pipe, or the autonomous `ndx work`
 *      loop's spawned child, is not.
 *
 * @param {string[]} flags
 * @param {{ isTTY?: boolean, env?: Record<string, string|undefined> }} ctx
 */
export function shouldShowPreflight(flags = [], ctx = {}) {
  if (flags.some((f) => BANNER_SUPPRESSING_FLAGS.has(f))) return false;

  const env = ctx.env ?? {};
  const override = env["NDX_PREFLIGHT"];
  if (override === "never" || override === "0") return false;
  if (override === "always" || override === "1") return true;

  if (env["CI"]) return false;
  return ctx.isTTY === true;
}

/** Identity styling — used when the caller passes no colour functions. */
const PLAIN_STYLE = { bold: (t) => t, dim: (t) => t, cyan: (t) => t, yellow: (t) => t, green: (t) => t };

/**
 * Render the preflight banner for `effects` as a list of lines.
 *
 * Returned as lines rather than a blob so the caller decides the stream and
 * the trailing newline — the banner goes to stderr, because stdout belongs to
 * whatever the command is producing.
 *
 * @param {CommandEffects} effects
 * @param {{bold?: Function, dim?: Function, cyan?: Function, yellow?: Function, green?: Function}} [style]
 * @returns {string[]}
 */
export function formatPreflightBanner(effects, style = {}) {
  const { bold, dim, cyan, yellow, green } = { ...PLAIN_STYLE, ...style };
  const lines = [];

  lines.push(`${bold(`ndx ${effects.command}`)} — ${effects.summary}`);
  lines.push("");

  lines.push(`  ${bold("reads")}    ${effects.reads[0]}`);
  for (const read of effects.reads.slice(1)) lines.push(`           ${read}`);

  if (effects.writes.length === 0) {
    lines.push(`  ${bold("writes")}   ${green("nothing — this command is read-only")}`);
  } else {
    let first = true;
    for (const write of effects.writes) {
      const label = first ? `  ${bold("writes")}  ` : "          ";
      first = false;
      const suffix = write.conditional ? dim(` (only with ${write.when})`) : "";
      lines.push(`${label} ${cyan(write.path)} — ${write.what}${suffix}`);
    }
  }

  if (effects.llm.length === 0) {
    lines.push(`  ${bold("llm")}      no model calls`);
  } else {
    let first = true;
    for (const phase of effects.llm) {
      const label = first ? `  ${bold("llm")}     ` : "          ";
      first = false;
      lines.push(`${label} ${yellow(phase.phase)}: ${phase.purpose} ${dim(`(~${phase.calls})`)}`);
    }
  }

  lines.push(`  ${bold("takes")}    ${effects.duration}`);
  lines.push("");
  lines.push(dim(`  Ctrl-C now to stop. Pass --yes to skip this pause.`));
  lines.push("");
  return lines;
}
