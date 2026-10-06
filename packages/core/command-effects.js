/**
 * Declared effects for every orchestrator command.
 *
 * Each entry says, once, what a command reads, what it writes, which phases
 * call an LLM, what network it touches and roughly how long it takes. The
 * declaration is the single source for three surfaces, so they can never
 * disagree about what a command is about to do:
 *
 *   - the terminal preflight banner printed before `ndx analyze`, `ndx plan`
 *     and `ndx recommend` (see `withPreflight` in cli.js);
 *   - the dashboard's `GET /api/commands/manifest`, which reads this map by
 *     spawning `ndx help --effects --format=json` (web cannot import core —
 *     core depends on web) and attaches each entry to its row unchanged;
 *   - the generated "Command effects" table in `docs/cli-ui-gap.md`
 *     (`node scripts/build-cli-ui-gap.mjs`).
 *
 * The map covers every command in the help registry (`help.js`
 * COMMAND_REGISTRY); `tests/unit/command-effects.test.js` fails on a registry
 * command without a declaration and on a declaration without a command.
 *
 * Paths the layout owns are written as tokens — `{rex}/prd_tree/`, `{config}` —
 * never as `.rex/` or `.n-dx.json`, because where those live depends on whether
 * the project is on the legacy or the `.ndx/` layout, and `layout.js` owns that
 * decision. {@link localizeEffects} expands the tokens against a project's
 * resolved paths; the dashboard receives them unexpanded along with the
 * project's `layoutPaths`, and the docs table prints them with a legend.
 * Every command also makes a background npm update check unless `--quiet` is
 * passed; that is a property of the CLI, not of any command, so no `network`
 * list repeats it.
 *
 * This module is pure data plus pure formatting. It reads no files, imports
 * nothing, and holds no state, which keeps it inside the orchestration tier's
 * spawn-only rule (see CLAUDE.md, "Tier boundary crossing") and makes the gate
 * decision directly unit-testable without a terminal.
 *
 * @module core/command-effects
 */

/**
 * @typedef {Object} WriteEffect
 * @property {string} path - Path written, relative to the project root, or a
 *   plain description ("source files", "git commits") when it is not one path.
 * @property {string} what - What lands there, in the user's terms.
 * @property {boolean} [conditional] - Only written under the condition named in `when`.
 * @property {string} [when] - The condition, phrased to follow "only": "with --accept",
 *   "without --dry-run", "on import", "when autoCommit is on".
 */

/**
 * @typedef {Object} LLMPhase
 * @property {string} phase - Phase name, as the command prints it.
 * @property {string} purpose - Why the phase needs a model.
 * @property {string} calls - Rough call count, as a range.
 */

/**
 * @typedef {Object} NetworkEffect
 * @property {"llm-provider"|"remote"|"localhost"} to - What kind of endpoint.
 * @property {string} what - Which endpoint, in the user's terms.
 * @property {string} [when] - The condition, phrased like {@link WriteEffect}'s, when the request is conditional.
 */

/**
 * @typedef {Object} CommandEffects
 * @property {string} command - Orchestrator command name.
 * @property {string} summary - One line: what running this does.
 * @property {string[]} reads - Paths and inputs consulted.
 * @property {WriteEffect[]} writes - Everything the command can write; empty means read-only.
 * @property {LLMPhase[]} llm - Phases that call a model; empty means no API spend.
 * @property {NetworkEffect[]} network - What the command talks to; empty means nothing.
 * @property {string[]} [noLlmFlags] - Flags that turn every LLM phase off for
 *   *this* command. Per command because the CLIs disagree: sourcevision honours
 *   `--fast` and drops `--no-llm`, while `ndx plan` honours `--no-llm` and rex
 *   ignores `--fast`.
 * @property {string} [delegates] - For a passthrough, the tool whose subcommand
 *   decides the real effects.
 * @property {string} duration - Rough wall-clock, for expectation-setting only.
 * @property {string} next - The command to run afterwards.
 */

/** Flags that suppress the banner outright: the caller has already decided. */
const BANNER_SUPPRESSING_FLAGS = new Set([
  "--yes", "-y",
  "--quiet", "-q",
  "--json", "--format=json",
]);

// ── Shared fragments ─────────────────────────────────────────────────────────
// Frozen so a consumer that mutates one entry cannot silently edit another.

const LLM_PROVIDER = Object.freeze({ to: "llm-provider", what: "the configured LLM vendor" });
const PRD_TREE = "{rex}/prd_tree/";
const PRD_READ = "{rex}/prd_tree/";
const SV_ANALYSIS_WRITE = Object.freeze({
  path: "{sourcevision}/",
  what: "inventory, import graph, zones, CONTEXT.md, llms.txt",
});
const SV_PHASES = Object.freeze([
  Object.freeze({ phase: "classify", purpose: "classify files the heuristics could not", calls: "0-N batches of 30 files" }),
  Object.freeze({ phase: "zones", purpose: "name and describe each detected zone", calls: "1-2 per batch of 7 zones; more passes with --full" }),
  Object.freeze({ phase: "primer", purpose: "write PRIMER.md", calls: "0-1" }),
  Object.freeze({ phase: "narration", purpose: "narrate escalated zones in a background child after the command returns", calls: "1 per escalated zone" }),
]);
const EXECUTION_LOG = Object.freeze({ path: "{rex}/execution-log.jsonl", what: "an activity entry" });

/** A PRD command that only reads the tree. */
function prdReader(command, summary, next, extraReads = []) {
  return {
    command,
    summary,
    reads: [PRD_READ, ...extraReads],
    writes: [],
    llm: [],
    network: [],
    duration: "seconds",
    next,
  };
}

/** A PRD command that rewrites part of the tree and logs it. */
function prdWriter(command, summary, what, next) {
  return {
    command,
    summary,
    reads: [PRD_READ],
    writes: [{ path: PRD_TREE, what }, EXECUTION_LOG],
    llm: [],
    network: [],
    duration: "seconds",
    next,
  };
}

/** A verbatim passthrough to one package CLI. */
function passthrough(command, tool, toolDir) {
  return {
    command,
    summary: `Run a ${tool} subcommand directly; its effects are that subcommand's.`,
    reads: [`${toolDir} and whatever the subcommand reads — see \`ndx ${command} --help\``],
    writes: [{ path: toolDir, what: "whatever the subcommand writes", conditional: true, when: "for a subcommand that writes" }],
    llm: [{ phase: "subcommand", purpose: "only subcommands that call a model", calls: "varies" }],
    network: [{ ...LLM_PROVIDER, when: "for a subcommand that calls a model" }],
    delegates: tool,
    duration: "depends on the subcommand",
    next: "ndx status",
  };
}

/** An alias: the same effects under another name. */
function alias(command, target) {
  return { ...target, command };
}

const start = {
  command: "start",
  summary: "Register the project with the per-user hub and serve the dashboard and MCP endpoints.",
  reads: ["{config} (web.*)", "~/.ndx/config.json and ~/.ndx/hub.json", "git identity"],
  writes: [
    { path: "{webPid} and {webPort}", what: "the running server's marker" },
    { path: "~/.ndx/hub.json", what: "the hub's project registry" },
    { path: "~/.ndx/auth.token", what: "the per-user dashboard token, on first start" },
  ],
  llm: [],
  network: [{ to: "localhost", what: "dashboard and MCP server on port 3117 (or --port)" }],
  duration: "long-running server; hub mode returns once registered",
  next: "ndx plan",
};

const pairProgramming = {
  command: "pair-programming",
  summary: "Run the agent on one task, then have a second vendor review and fix what it did.",
  reads: ["{sourcevision}/PRIMER.md or CONTEXT.md", PRD_READ, "{rex}/config.json (test command)", "git changes"],
  writes: [
    { path: PRD_TREE, what: "a task for the session" },
    { path: "{hench}/runs/", what: "run records" },
    { path: "source files", what: "the agent's edits and the reviewer's small fixes" },
  ],
  llm: [
    { phase: "agent", purpose: "implement the task", calls: "1 agent session" },
    { phase: "review", purpose: "cross-vendor review of the change", calls: "1-2 reviewer sessions" },
    { phase: "remediation", purpose: "address the review", calls: "0-1 agent session" },
  ],
  network: [LLM_PROVIDER],
  duration: "minutes to tens of minutes",
  next: "ndx status",
};

/** @type {Record<string, CommandEffects>} */
export const COMMAND_EFFECTS = {
  init: {
    command: "init",
    summary: "Create the rex, hench and sourcevision directories, choose an LLM, and wire up assistants.",
    reads: ["{config}", "existing tool directories", "CLAUDE.md, AGENTS.md, .claude/ and .codex/", "git state"],
    writes: [
      { path: "{rex}/, {hench}/, {sourcevision}/", what: "tool directories and a first fast analysis" },
      { path: "{config}, .gitignore, .gitattributes", what: "project config and git rules" },
      { path: "CLAUDE.md, AGENTS.md, .claude/, .agents/, .codex/, .mcp.json", what: "assistant instructions, skills and MCP registration" },
      { path: "README.md", what: "a README, or README.proposed.md beside an existing one" },
      { path: "~/.claude.json", what: "local-scope MCP registration", conditional: true, when: "with --mcp-scope=local" },
      { path: ".git/", what: "a git repository and a `chore: n-dx init` baseline commit", conditional: true, when: "with --git, or on a TTY when the preflight prompt is accepted" },
    ],
    llm: [{ phase: "auth probe", purpose: "check the chosen vendor answers", calls: "0-1" }],
    network: [LLM_PROVIDER],
    duration: "under a minute",
    next: "ndx plan",
  },

  "migrate-layout": {
    command: "migrate-layout",
    summary: "Move the project's n-dx state into .ndx/ and commit the move.",
    reads: ["{rex}/, {hench}/, {sourcevision}/, {config} and {localConfig}", "git status"],
    writes: [
      { path: ".ndx/", what: "the moved tool directories and config" },
      { path: ".gitignore, .gitattributes", what: "rewritten path patterns" },
      { path: "git commits", what: "the move", conditional: true, when: "without --no-commit" },
    ],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx status",
  },

  analyze: {
    command: "analyze",
    summary: "Scan the codebase and rewrite the SourceVision analysis.",
    reads: [
      "every tracked source file under the project",
      "{sourcevision}/manifest.json (the previous run)",
    ],
    writes: [
      SV_ANALYSIS_WRITE,
    ],
    llm: [...SV_PHASES],
    network: [LLM_PROVIDER],
    noLlmFlags: ["--fast"],
    duration: "under a minute on a small repo; several minutes with --deep or --full",
    next: "ndx plan",
  },

  recommend: {
    command: "recommend",
    summary: "Group SourceVision findings into recommendations you can accept.",
    reads: [
      "{sourcevision}/ (findings from the last analysis)",
      "{rex}/prd_tree/ and {rex}/acknowledged-findings.json",
    ],
    writes: [
      { path: "{rex}/acknowledged-findings.json", what: "acknowledgements", conditional: true, when: "with --acknowledge" },
      { path: PRD_TREE, what: "accepted recommendations as PRD items", conditional: true, when: "with --accept" },
    ],
    // Recommendations are grouped from findings deterministically — no model is
    // consulted. Saying so is the point of the banner: this one is free.
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx work",
  },

  plan: {
    command: "plan",
    summary: "Re-analyze, then propose PRD items from what the analysis found.",
    reads: [
      "every tracked source file under the project",
      "{sourcevision}/ (refreshed first)",
      "{rex}/prd_tree/ (to avoid proposing what already exists)",
    ],
    writes: [
      SV_ANALYSIS_WRITE,
      { path: "{rex}/pending-proposals.json", what: "the proposals, cached for a later --accept" },
      { path: PRD_TREE, what: "accepted proposals as PRD items", conditional: true, when: "with --accept" },
    ],
    llm: [
      ...SV_PHASES,
      { phase: "proposals", purpose: "draft PRD items from findings and scans", calls: "1 per proposal batch" },
      { phase: "decomposition", purpose: "split proposals that are too large for one task", calls: "0-1 per oversized proposal" },
    ],
    network: [LLM_PROVIDER],
    // `ndx plan --no-llm` hands sourcevision `--fast` and rex `--no-llm`, so it
    // silences both halves. `--fast` reaches only rex, which ignores it.
    noLlmFlags: ["--no-llm"],
    duration: "a few minutes — it runs a full analysis first",
    next: "ndx status",
  },

  add: {
    command: "add",
    summary: "Turn a description, file or stdin into PRD items.",
    reads: [PRD_READ, "{rex}/config.json", "{sourcevision}/ (context)", "the given files or stdin"],
    writes: [
      { path: "{rex}/pending-smart-proposals.json", what: "the drafted items, cached for a later --accept" },
      { path: PRD_TREE, what: "the new items", conditional: true, when: "with --accept or --title, or when accepted at the prompt" },
      EXECUTION_LOG,
    ],
    llm: [
      { phase: "smart add", purpose: "draft items from the description", calls: "1 (none with --title)" },
      { phase: "consolidation", purpose: "check the draft against existing siblings", calls: "0-2" },
    ],
    network: [{ ...LLM_PROVIDER, when: "without --title" }],
    duration: "seconds to under a minute",
    next: "ndx work",
  },

  refresh: {
    command: "refresh",
    summary: "Re-run the analysis and rebuild the dashboard's data and UI artifacts.",
    reads: ["{sourcevision}/", "{webPid} and {webPort}"],
    writes: [
      { ...SV_ANALYSIS_WRITE, conditional: true, when: "without --ui-only" },
      { path: "{sourcevision}/dashboard-artifacts.json", what: "the artifact manifest" },
      { path: "the dashboard build", what: "rebuilt UI assets", conditional: true, when: "without --data-only or --no-build" },
    ],
    llm: [...SV_PHASES],
    network: [LLM_PROVIDER, { to: "localhost", what: "the running dashboard's reload endpoint", when: "with --live-server" }],
    noLlmFlags: ["--fast", "--ui-only"],
    duration: "a minute to several minutes",
    next: "ndx start",
  },

  work: {
    command: "work",
    summary: "Pick the next task and let the hench agent implement it.",
    reads: [PRD_READ, "{hench}/config.json", "{sourcevision}/CONTEXT.md and PRIMER.md", "the repository trust record"],
    writes: [
      { path: "source files", what: "the agent's changes" },
      { path: "git commits", what: "the task's work", conditional: true, when: "when autoCommit is on, the default" },
      { path: "{hench}/runs/", what: "run records and transcripts" },
      { path: PRD_TREE, what: "task status" },
      EXECUTION_LOG,
      { path: "<git-common-dir>/ndx/claims.json", what: "the claim on the running task" },
    ],
    llm: [
      { phase: "agent", purpose: "implement the task", calls: "1 agent session per task" },
      { phase: "review", purpose: "check the change before it is committed", calls: "0-1 per task" },
      { phase: "commit message", purpose: "summarise a dirty tree before the run", calls: "0-1" },
    ],
    network: [LLM_PROVIDER],
    noLlmFlags: ["--dry-run"],
    duration: "minutes per task; --loop runs until the queue is empty",
    next: "ndx status",
  },

  status: prdReader("status", "Print the PRD tree with completion stats.", "ndx work", ["{hench}/runs/ (token totals)"]),

  usage: {
    command: "usage",
    summary: "Summarise token usage and cost across packages.",
    reads: ["{hench}/runs/", "rex and sourcevision token logs"],
    writes: [],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx status",
  },

  claim: {
    command: "claim",
    summary: "List or release cross-worktree task claims.",
    reads: ["<git-common-dir>/ndx/claims.json"],
    writes: [{ path: "<git-common-dir>/ndx/claims.json", what: "the released claim", conditional: true, when: "on release" }],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx work",
  },

  sync: {
    command: "sync",
    summary: "Push and pull PRD items to a remote tracker.",
    reads: [PRD_READ, "{rex}/adapters.json", "adapter credentials from the environment"],
    writes: [
      { path: PRD_TREE, what: "items pulled from the remote", conditional: true, when: "without --push" },
      EXECUTION_LOG,
      { path: "the remote tracker", what: "items pushed from the PRD", conditional: true, when: "without --pull or --dry-run" },
    ],
    llm: [],
    network: [{ to: "remote", what: "the configured adapter (Notion by default)" }],
    duration: "seconds to a minute",
    next: "ndx status",
  },

  start,

  "install-sample": {
    command: "install-sample",
    summary: "Add a small sample app and four PRD tasks to try the loop on.",
    reads: [],
    writes: [
      { path: "sample-app/", what: "index.html, style.css, app.js" },
      { path: "{rex}/prd_tree/sample-app-improvements/", what: "four sample tasks" },
    ],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx work",
  },

  "destroy-sample": {
    command: "destroy-sample",
    summary: "Delete the sample app and its PRD tasks.",
    reads: [PRD_READ],
    writes: [
      { path: "sample-app/", what: "deleted" },
      { path: PRD_TREE, what: "the sample tasks, deleted" },
    ],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx status",
  },

  dev: {
    command: "dev",
    summary: "Run the dashboard dev server with live reload.",
    reads: ["{sourcevision}/", "the web package source"],
    writes: [{ path: "the dashboard build", what: "the rebuilt viewer, on every change" }],
    llm: [],
    network: [{ to: "localhost", what: "the dev server" }],
    duration: "until stopped",
    next: "ndx start",
  },

  web: alias("web", start),

  ci: {
    command: "ci",
    summary: "Re-run a fast analysis and check PRD health and architecture gates.",
    reads: ["{rex}/", "{sourcevision}/", "every source file", "gateway-rules.json", "docs and git log"],
    writes: [SV_ANALYSIS_WRITE],
    llm: [],
    network: [],
    duration: "minutes",
    next: "ndx status",
  },

  which: {
    command: "which",
    summary: "Report which n-dx install is running and how.",
    reads: ["the CLI's own package.json and install path", "the project's git identity"],
    writes: [],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx status",
  },

  config: {
    command: "config",
    summary: "Read or change settings across {config} and the per-package configs.",
    reads: ["{config} and {localConfig}", "{rex}/config.json", "{hench}/config.json"],
    writes: [
      { path: "{config}, {localConfig}, {rex}/config.json, {hench}/config.json", what: "the changed key (secrets go to {localConfig})", conditional: true, when: "when setting a value" },
    ],
    llm: [{ phase: "auth probe", purpose: "check a newly chosen vendor answers", calls: "0-1" }],
    network: [{ ...LLM_PROVIDER, when: "when setting llm.vendor, or with --test-connection" }],
    duration: "seconds",
    next: "ndx auth",
  },

  auth: {
    command: "auth",
    summary: "Check the configured LLM vendor's credentials.",
    reads: ["{config}", "vendor credentials"],
    writes: [],
    llm: [{ phase: "auth probe", purpose: "confirm the vendor answers", calls: "1" }],
    network: [LLM_PROVIDER],
    duration: "seconds",
    next: "ndx plan",
  },

  export: {
    command: "export",
    summary: "Publish a static copy of the dashboard.",
    reads: ["{sourcevision}/", PRD_READ, "{rex}/execution-log.jsonl", "{hench}/runs/", "the built viewer"],
    writes: [
      { path: "ndx-export/", what: "the static dashboard" },
      { path: ".gitignore", what: "an ndx-export/ entry" },
      { path: "the n-dx-dashboard branch", what: "a force-pushed deploy", conditional: true, when: "with --deploy=github" },
    ],
    llm: [],
    network: [{ to: "remote", what: "git push to origin", when: "with --deploy=github" }],
    duration: "seconds to a minute",
    next: "ndx start",
  },

  prd: {
    command: "prd",
    summary: "Export the PRD to a bundle or prose file, or import a bundle.",
    reads: [PRD_READ, "the --in bundle"],
    writes: [
      { path: "the --out file", what: "the bundle or narrative", conditional: true, when: "on export" },
      { path: PRD_TREE, what: "the imported items", conditional: true, when: "on import" },
      { path: "{rex}/.backups/", what: "a snapshot before import", conditional: true, when: "on import, without --no-snapshot" },
    ],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx status",
  },

  trust: {
    command: "trust",
    summary: "Review or accept the execution config this checkout ships.",
    reads: ["{hench}/config.json", "{rex}/config.json", ".mcp.json", "the trust record"],
    writes: [{ path: "~/.ndx/trust/", what: "the trust record", conditional: true, when: "on accept or revoke" }],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx work",
  },

  "self-heal": {
    command: "self-heal",
    summary: "Loop: deep analysis, accept recommendations, then let the agent fix them.",
    reads: ["{sourcevision}/", PRD_READ, "{config} (selfHeal.*)"],
    writes: [
      SV_ANALYSIS_WRITE,
      { path: PRD_TREE, what: "recommendations tagged self-heal" },
      { path: "{rex}/acknowledged-findings.json", what: "acknowledgements" },
      { path: "source files", what: "the agent's fixes", conditional: true, when: "without --capture-only" },
      { path: "git commits", what: "each fix", conditional: true, when: "without --capture-only" },
      { path: "{hench}/runs/", what: "run records", conditional: true, when: "without --capture-only" },
    ],
    llm: [
      { phase: "analysis", purpose: "deep, full zone enrichment", calls: "several per zone batch, per iteration" },
      { phase: "agent", purpose: "fix each accepted recommendation", calls: "1 agent session per task" },
    ],
    network: [LLM_PROVIDER],
    duration: "long — tens of minutes to hours",
    next: "ndx status",
  },

  "pair-programming": pairProgramming,
  bicker: alias("bicker", pairProgramming),

  validate: {
    command: "validate",
    summary: "Check PRD integrity: schema, orphans, cycles.",
    reads: [PRD_READ, "{rex}/config.json"],
    writes: [{ path: PRD_TREE, what: "repairs", conditional: true, when: "with --post-merge --repair, or when a fix is accepted at the prompt" }],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx fix",
  },

  fix: {
    command: "fix",
    summary: "Repair the PRD problems validate reports.",
    reads: [PRD_READ],
    writes: [{ path: PRD_TREE, what: "repaired items", conditional: true, when: "without --dry-run" }],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx validate",
  },

  health: prdReader("health", "Score the PRD's structure.", "ndx reshape"),
  report: prdReader("report", "Print a PRD health and progress report.", "ndx status"),

  verify: {
    command: "verify",
    summary: "Run the tests mapped to each task's acceptance criteria.",
    reads: [PRD_READ, "test files", "{rex}/config.json (test command)"],
    // It runs the project's test command, which may write whatever the
    // project's tests write — not something n-dx can declare.
    writes: [],
    llm: [],
    network: [],
    duration: "seconds to two minutes",
    next: "ndx update",
  },

  log: {
    command: "log",
    summary: "Append an entry to the execution log.",
    reads: [],
    writes: [EXECUTION_LOG],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx status",
  },

  update: prdWriter("update", "Change an item's status, priority or title.", "the item, and parents it completes", "ndx next"),
  remove: prdWriter("remove", "Delete an item and its descendants.", "the item, deleted", "ndx status"),
  move: prdWriter("move", "Reparent an item.", "the moved item", "ndx tree"),

  reshape: {
    command: "reshape",
    summary: "Restructure the PRD hierarchy with model-proposed merges and regroupings.",
    reads: [PRD_READ, "{rex}/config.json"],
    writes: [
      { path: "{rex}/.backups/", what: "a snapshot before any change" },
      { path: PRD_TREE, what: "accepted restructures", conditional: true, when: "with --accept" },
      { path: "{rex}/archive.json", what: "items removed by the restructure", conditional: true, when: "with --accept" },
    ],
    llm: [
      { phase: "proposals", purpose: "propose merges, moves and regroupings", calls: "1-N" },
      { phase: "merge bodies", purpose: "write merged item descriptions", calls: "0-N" },
    ],
    network: [LLM_PROVIDER],
    duration: "a minute to several minutes",
    next: "ndx status",
  },

  reorganize: {
    command: "reorganize",
    summary: "Detect and fix structural problems in the PRD.",
    reads: [PRD_READ],
    writes: [
      { path: "{rex}/.backups/", what: "a snapshot" },
      { path: PRD_TREE, what: "accepted fixes", conditional: true, when: "with --accept or --accept-llm" },
    ],
    llm: [{ phase: "proposals", purpose: "propose fixes beyond the deterministic ones", calls: "0-N" }],
    network: [LLM_PROVIDER],
    noLlmFlags: ["--fast", "--mode=fast"],
    duration: "about a minute",
    next: "ndx status",
  },

  prune: {
    command: "prune",
    summary: "Archive completed work out of the PRD tree.",
    reads: [PRD_READ],
    writes: [
      { path: "{rex}/.backups/", what: "a snapshot" },
      { path: PRD_TREE, what: "pruned items removed", conditional: true, when: "without --dry-run" },
      { path: "{rex}/archive.json", what: "the pruned items", conditional: true, when: "without --dry-run" },
    ],
    llm: [{ phase: "consolidation", purpose: "merge near-duplicate leftovers", calls: "0-1 (none with --no-consolidate)" }],
    network: [LLM_PROVIDER],
    duration: "seconds to a minute",
    next: "ndx status",
  },

  next: prdReader("next", "Print the next actionable task.", "ndx work"),
  tree: prdReader("tree", "Print the PRD hierarchy.", "ndx next"),
  "tree-diff": prdReader("tree-diff", "Compare the PRD tree between two git refs or directories.", "ndx status", ["git history"]),

  reset: {
    command: "reset",
    summary: "Delete the SourceVision analysis so the next analyze starts fresh.",
    reads: ["{sourcevision}/"],
    writes: [
      { path: "{sourcevision}/", what: "deleted (top-level files copied to {sourcevision}/.backup/ first)" },
    ],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx analyze",
  },

  show: {
    command: "show",
    summary: "Print one hench run in full.",
    reads: ["{hench}/runs/<id>.json"],
    writes: [],
    llm: [],
    network: [],
    duration: "seconds",
    next: "ndx status",
  },

  rex: passthrough("rex", "rex", "{rex}/"),
  hench: passthrough("hench", "hench", "{hench}/"),
  sourcevision: passthrough("sourcevision", "sourcevision", "{sourcevision}/"),
  sv: passthrough("sv", "sourcevision", "{sourcevision}/"),
};

/**
 * The layout tokens a declaration may use, each naming the `layout.js`
 * `resolveLayout` field it stands for.
 */
export const LAYOUT_TOKENS = Object.freeze({
  rex: "rexDir",
  hench: "henchDir",
  sourcevision: "sourcevisionDir",
  config: "configFile",
  localConfig: "localConfigFile",
  webPid: "webPidFile",
  webPort: "webPortFile",
});

const TOKEN_PATTERN = /\{(\w+)\}/g;

/**
 * Every token in `text` replaced by its project-relative path from
 * `layoutPaths` (token → path). An unknown token is left as written.
 *
 * @param {string} text
 * @param {Record<string, string>} layoutPaths
 */
export function expandLayoutTokens(text, layoutPaths) {
  return text.replace(TOKEN_PATTERN, (match, token) => layoutPaths[token] ?? match);
}

/**
 * `effects` with every layout token expanded — what the banner prints and the
 * run summary checks. Returns a copy; the declaration is untouched.
 *
 * @param {CommandEffects} effects
 * @param {Record<string, string>} layoutPaths - Token → project-relative path.
 * @returns {CommandEffects}
 */
export function localizeEffects(effects, layoutPaths) {
  const expand = (value) => {
    if (typeof value === "string") return expandLayoutTokens(value, layoutPaths);
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
    }
    return value;
  };
  return expand(effects);
}

/** The declared effects of `command`, or `null` when it has none. */
export function getCommandEffects(command) {
  return Object.hasOwn(COMMAND_EFFECTS, command) ? COMMAND_EFFECTS[command] : null;
}

/**
 * The effects of `command` as they apply to *this* invocation.
 *
 * Today that means dropping the LLM phases, and the LLM network request,
 * under one of the command's own `noLlmFlags`: a banner that advertises model
 * calls a run will not make is worse than no banner, because it teaches the
 * reader to stop believing it. The reverse matters as much — a flag the
 * command ignores must not make the banner promise a free run.
 *
 * @param {string} command
 * @param {string[]} flags
 * @returns {CommandEffects|null}
 */
export function resolveCommandEffects(command, flags = []) {
  const base = getCommandEffects(command);
  if (!base) return null;
  const silencers = base.noLlmFlags ?? [];
  if (!flags.some((f) => silencers.includes(f))) return base;
  return { ...base, llm: [], network: base.network.filter((n) => n.to !== "llm-provider") };
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

  lines.push(`  ${bold("reads")}    ${effects.reads[0] ?? "nothing"}`);
  for (const read of effects.reads.slice(1)) lines.push(`           ${read}`);

  if (effects.writes.length === 0) {
    lines.push(`  ${bold("writes")}   ${green("nothing — this command is read-only")}`);
  } else {
    let first = true;
    for (const write of effects.writes) {
      const label = first ? `  ${bold("writes")}  ` : "          ";
      first = false;
      const suffix = write.conditional ? dim(` (only ${write.when})`) : "";
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
