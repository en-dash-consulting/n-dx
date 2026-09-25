/**
 * Command-specific help content for the hench CLI.
 *
 * Each command has a dedicated help definition that includes:
 *   - Synopsis / usage pattern
 *   - Relevant flags only
 *   - 2–3 practical examples
 *
 * Uses the shared formatHelp() from @n-dx/llm-client for consistent
 * presentation with semantic color coding across all n-dx packages.
 *
 * @module hench/cli/help
 */

import { formatHelp } from "../prd/llm-gateway.js";
import type { HelpDefinition } from "../prd/llm-gateway.js";

/** Map of command name → help definition. */
const COMMAND_DEFS: Record<string, HelpDefinition> = {
  init: {
    tool: "hench",
    command: "init",
    summary: "create .hench/ with default configuration",
    usage: "hench init [dir]",
    description:
      "Sets up .hench/ with config.json and a runs/ directory. If .hench/\n" +
      "already exists, reports it and skips.",
    examples: [
      { command: "hench init", description: "Initialize in current directory" },
      { command: "hench init ./my-project", description: "Initialize in a specific directory" },
    ],
    related: ["run", "config"],
  },
  run: {
    tool: "hench",
    command: "run",
    summary: "execute a task from the Rex PRD",
    usage: "hench run [options] [dir]",
    description:
      "Picks the next actionable task from the PRD (or a specific one via --task),\n" +
      "builds a brief, and runs an autonomous agent loop using Claude. The agent\n" +
      "can read/write files, run commands, and update task status.",
    options: [
      { flag: "--task=<id>", description: "Target a specific Rex task ID" },
      { flag: "--epic=<id|title>", description: "Only consider tasks within the specified epic" },
      { flag: "--epic-by-epic", description: "Process epics sequentially, advancing when done" },
      { flag: "--auto", description: "Skip interactive selection, autoselect by priority" },
      { flag: "--iterations=<n>", description: "Run multiple tasks sequentially (e.g. --iterations=5)" },
      { flag: "--loop", description: "Run continuously until all tasks complete or Ctrl+C" },
      { flag: "--loop-pause=<ms>", description: "Pause between loop iterations (default: config value)" },
      { flag: "--priority=<level>", description: "Override task scheduling priority (critical|high|medium|low)" },
      { flag: "--reset-deferred", description: "Reset all deferred/failing tasks to pending before running" },
      { flag: "--dry-run", description: "Print the task brief without calling Claude" },
      { flag: "--review", description: "Run an adversarial review pass after each task validates: fix must-fix findings in-session, capture the rest to the PRD" },
      { flag: "--review-model=<model>", description: "Model for the review pass (default: the recommended reviewer for your vendor)" },
      { flag: "--review-optional", description: "Accept a best-effort review: warn instead of refusing the completion when the reviewer cannot start" },
      { flag: "--approve-diff", description: "Show proposed changes and prompt for approval (was --review before the review pass took that flag)" },
      { flag: "--max-turns=<n>", description: "Override max agent turns per task" },
      { flag: "--token-budget=<n>", description: "Cap total tokens per run (0 = unlimited)" },
      { flag: "--model=<model>", description: "Override the Claude model" },
      { flag: "--permission-mode=<mode>", description: "Claude permission posture: default | acceptEdits | bypassPermissions | plan (autonomous runs default to acceptEdits)" },
      { flag: "--allow-dirty", description: "Start with an uncommitted working tree: autonomous runs (--auto/--loop/--epic-by-epic) abort by default, and this flag also overrides hench.git.requireCleanTree and hench.git.checkpointThreshold escalation" },
      { flag: "--skip-test-gate", description: "Skip the mandatory full test suite gate before commit for this invocation (persistent equivalent: hench.skipFullTestGate config)" },
      { flag: "--fresh", description: "Discard the cached orientation session and orient again before forking task spawns (see hench.sessionStrategy)" },
    ],
    sections: [
      {
        title: "Adversarial review (--review)",
        content:
          "After a task's changes pass completion validation and before the\n" +
          "commit prompt, a reviewer attacks the change: it finds failures,\n" +
          "triages each for severity and necessity, fixes what must be fixed,\n" +
          "and captures the rest to the PRD. Fixes land in the same commit as\n" +
          "the work they repair.\n" +
          "\n" +
          "For the Claude CLI the reviewer resumes the session that did the\n" +
          "work, so it inherits what was tried and rejected — not just the diff.\n" +
          "Other vendors get a fresh reviewer seeded with the task context.\n" +
          "\n" +
          "Model: --review-model wins, then llm.<vendor>.reviewModel, then\n" +
          "llm.reviewModel, then the vendor default (claude: claude-opus-5).\n" +
          "The execution model is never inherited — pinning a cheap executor\n" +
          "must not silently downgrade the reviewer.\n" +
          "\n" +
          "Requires the CLI provider.\n" +
          "\n" +
          "--review is a gate. If no reviewer ever starts — a spawn failure, a\n" +
          "model the installed vendor CLI rejects, a vendor with no reviewer —\n" +
          "the run is refused rather than reported completed, because \"could not\n" +
          "review\" must not read as \"reviewed, found nothing\". The validated work\n" +
          "is left in the tree, the task returns to pending rather than deferred,\n" +
          "and the run does not count toward stuck-task detection: the usual cause\n" +
          "is a config line, not a defect in the task. Pass --review-optional to\n" +
          "downgrade that refusal to a warning.\n" +
          "\n" +
          "A reviewer that *did* run but lost its report only warns: the change\n" +
          "was attacked, and the task's own result stands.",
      },
      {
        title: "Pre-run commit gate",
        content:
          "The gate is size-aware: when uncommitted changes reach\n" +
          "hench.git.checkpointThreshold lines changed (default: 200, 0 disables),\n" +
          "the interactive prompt defaults to committing a checkpoint first. With\n" +
          "hench.git.requireCleanTree=true, dirty runs must commit or stop.\n" +
          "Precedence: --allow-dirty flag > hench.git.* config > defaults.",
      },
    ],
    examples: [
      { command: "hench run", description: "Run next task (interactive selection)" },
      { command: "hench run --task=abc123", description: "Run a specific task" },
      { command: "hench run --epic=\"Auth\" --auto", description: "Auto-run tasks in the Auth epic" },
      { command: "hench run --loop --epic-by-epic", description: "Continuously process epics in order" },
      { command: "hench run --dry-run .", description: "Preview the brief without execution" },
      { command: "hench run --auto --review", description: "Auto-run with an adversarial review pass after each task" },
      { command: "hench run --review --review-model=claude-fable-5", description: "Review on a specific model" },
    ],
    related: ["status", "show"],
  },
  record: {
    tool: "hench",
    command: "record",
    summary: "write an assisted run record to .hench/runs/",
    usage: "hench record --task=<id> [options] [dir]",
    description:
      "Writes a lightweight run record for work performed through a skill\n" +
      "(Claude Code) rather than a spawned hench agent, so it appears in run\n" +
      "history and is auditable. The record is marked assisted.\n" +
      "\n" +
      "Token usage is read from the current Claude Code session's transcript,\n" +
      "which is where Claude Code records the API's own usage numbers; the\n" +
      "session is located via CLAUDE_CODE_SESSION_ID. When 'hench usage mark\n" +
      "--task=<id>' was run at the start of the task, the record claims exactly\n" +
      "what accumulated after that mark — the difference between two positions\n" +
      "in the transcript, computed here, per token class. Without a mark it\n" +
      "falls back to the spend since the previous record for the session (a\n" +
      "warning names the mark command). Marks and the watermark live in\n" +
      ".hench/usage-cursors/.\n" +
      "\n" +
      "Precedence: explicit --*-tokens flags, then the mark, then the session\n" +
      "watermark, then zeros. A missing transcript never fails the record — an\n" +
      "unrecorded run is worse than one missing its tokens.\n" +
      "\n" +
      "--startedAt is the run's start time and nothing more: it never selects\n" +
      "usage. Omit it when a mark exists — the mark knows when the task began.\n" +
      "--since is an explicit time window for the rare case that needs one.\n" +
      "An unparseable --startedAt/--since value is an error, not a silent no-op.",
    options: [
      { flag: "--task=<id>", description: "Rex task ID the work addressed (required)" },
      { flag: "--title=<title>", description: "Task title (defaults to the task ID)" },
      { flag: "--status=<status>", description: "Run status: completed (default) | failed | cancelled | ..." },
      { flag: "--summary=<text>", description: "Short description of what was done" },
      { flag: "--turns=<n>", description: "Agent turns (default: the transcript's message count)" },
      { flag: "--no-tokens", description: "Record without token usage (the suppressed spend is discarded — it does not roll into the session's next record)" },
      { flag: "--mark=<id>", description: "Consume this usage mark instead of the one named by --task" },
      { flag: "--startedAt=<iso>", description: "Run start time (metadata only; defaults to the mark's time)" },
      { flag: "--since=<iso>", description: "Claim spend from this time only (explicit window; skips the mark)" },
      { flag: "--session=<id>", description: "Session to read (default: $CLAUDE_CODE_SESSION_ID)" },
      { flag: "--transcript=<path>", description: "Read this transcript instead of searching by session" },
      { flag: "--input-tokens=<n>", description: "Set input tokens by hand (overrides the transcript)" },
      { flag: "--output-tokens=<n>", description: "Set output tokens by hand" },
      { flag: "--cache-creation-tokens=<n>", description: "Set cache-creation tokens by hand" },
      { flag: "--cache-read-tokens=<n>", description: "Set cache-read tokens by hand" },
      { flag: "--model=<id>", description: "Model to record (default: the transcript's, else config)" },
      { flag: "--format=json", description: "Output the new run ID and usage as JSON" },
    ],
    examples: [
      { command: "hench usage mark --task=abc123 && … && hench record --task=abc123 --status=completed", description: "Mark at the start, record at the end: usage is the difference" },
      { command: "hench record --task=abc123 --status=completed", description: "Without a mark: claims the spend since the session's previous record (warned)" },
      { command: "hench record --task=abc123 --title=\"Add auth\" --summary=\"Implemented login\"", description: "Record with title and summary" },
      { command: "hench record --task=abc123 --no-tokens", description: "Record without attributing any token usage" },
    ],
    related: ["usage", "run", "status", "show"],
  },
  usage: {
    tool: "hench",
    command: "usage",
    summary: "mark where a task's token usage starts",
    usage: "hench usage mark --task=<id> [dir] | hench usage marks [dir]",
    description:
      "mark: snapshot the current Claude Code session's cumulative token usage\n" +
      "and transcript position under the task id, in .hench/usage-cursors/. Run\n" +
      "it the moment a task begins; 'hench record --task=<id>' then reports the\n" +
      "difference between that snapshot and the transcript at record time —\n" +
      "arithmetic on two positions in the same file, no typed timestamp.\n" +
      "Re-marking the same task overwrites. Without a session or transcript it\n" +
      "warns and marks nothing; the record then falls back to the watermark.\n" +
      "\n" +
      "marks: list the marks the session still holds.",
    options: [
      { flag: "--task=<id>", description: "Task (or skill:<name>) the mark is for (required for mark)" },
      { flag: "--session=<id>", description: "Session to read (default: $CLAUDE_CODE_SESSION_ID)" },
      { flag: "--transcript=<path>", description: "Read this transcript instead of searching by session" },
      { flag: "--format=json", description: "Output the mark as JSON" },
    ],
    examples: [
      { command: "hench usage mark --task=abc123 .", description: "Mark the start of task abc123" },
      { command: "hench usage mark --task=skill:ndx-plan .", description: "Mark under a skill name when the item id is not known yet" },
      { command: "hench usage marks .", description: "Show pending marks for this session" },
    ],
    related: ["record"],
  },
  status: {
    tool: "hench",
    command: "status",
    summary: "show recent run history",
    usage: "hench status [options] [dir]",
    description:
      "Lists recent agent runs with their task, status, duration, and token usage.",
    options: [
      { flag: "--last=<n>", description: "Number of recent runs to show (default: 10)" },
      { flag: "--format=json", description: "Output as JSON" },
    ],
    examples: [
      { command: "hench status", description: "Show last 10 runs" },
      { command: "hench status --last=20", description: "Show last 20 runs" },
      { command: "hench status --format=json .", description: "Machine-readable output" },
    ],
    related: ["show", "run"],
  },
  show: {
    tool: "hench",
    command: "show",
    summary: "show full details of a specific run",
    usage: "hench show <run-id> [options] [dir]",
    description:
      "Displays comprehensive details about a single agent run including task\n" +
      "info, model, timing, turns, token usage, and the outcome.",
    options: [
      { flag: "--format=json", description: "Output as JSON" },
      { flag: "--events", description: "Display the RuntimeEvent stream (requires useEventPipeline)" },
    ],
    examples: [
      { command: "hench show abc123", description: "Show run details" },
      { command: "hench show abc123 --format=json", description: "JSON output for scripting" },
      { command: "hench show abc123 --events", description: "Display event stream for debugging" },
    ],
    related: ["status"],
  },
  review: {
    tool: "hench",
    command: "review",
    summary: "inspect what an adversarial review pass left behind",
    usage: "hench review pending <run-id> [options] [dir]",
    description:
      "Lists the findings a `--review` run deferred instead of capturing.\n" +
      "The reviewer runs headless, so nobody is at its capture prompt even\n" +
      "on an attended run: a finding it would have offered is parked with a\n" +
      "`deferred` disposition and an id rather than being dropped into\n" +
      "scrollback.\n" +
      "\n" +
      "Each finding is listed with its id, severity, verdict and failure\n" +
      "scenario. To capture one, run the /ndx-adversarial-review skill and\n" +
      "name the run and the ids — it owns the duplicate check and the choice\n" +
      "of parent that turning a finding into a PRD item requires.",
    options: [
      { flag: "--format=json", description: "Output as JSON" },
    ],
    examples: [
      { command: "hench review pending abc123", description: "List deferred findings for a run" },
      {
        command: "hench review pending abc123 --format=json",
        description: "Machine-readable output",
      },
    ],
    related: ["show", "status"],
  },
  config: {
    tool: "hench",
    command: "config",
    summary: "view or edit workflow configuration",
    usage: [
      "hench config [dir]",
      "hench config <key> [dir]",
      "hench config <key> <value> [dir]",
      "hench config --interactive [dir]",
    ],
    description:
      "Manages .hench/config.json settings including provider, model, max turns,\n" +
      "guard rules, retry behavior, and task selection preferences.",
    options: [
      { flag: "--interactive", description: "Launch interactive configuration menu" },
      { flag: "--format=json", description: "Output current config as JSON" },
    ],
    examples: [
      { command: "hench config", description: "Display all current settings" },
      { command: "hench config model", description: "Show current model" },
      { command: "hench config model claude-sonnet-5", description: "Set the model" },
      { command: "hench config --interactive", description: "Interactive menu for all settings" },
    ],
    related: ["template"],
  },
  template: {
    tool: "hench",
    command: "template",
    summary: "manage workflow templates",
    usage: "hench template <subcommand> [id] [options] [dir]",
    description:
      "Workflow templates are pre-configured sets of hench settings that can\n" +
      "be applied to quickly switch between different execution strategies.",
    sections: [
      {
        title: "Subcommands",
        content:
          "list                  List all available templates (built-in and user)\n" +
          "show <id>             Show template details and settings\n" +
          "apply <id>            Apply a template to current config\n" +
          "save <id>             Save current config as a user template\n" +
          "delete <id>           Delete a user-defined template",
      },
    ],
    options: [
      { flag: "--name=\"...\"", description: "Template name (for save)" },
      { flag: "--description=\"...\"", description: "Template description (for save)" },
      { flag: "--format=json", description: "Output as JSON (for list, show)" },
    ],
    examples: [
      { command: "hench template list", description: "List all templates" },
      { command: "hench template apply cautious", description: "Apply the cautious template" },
      { command: "hench template save my-setup --name=\"My Setup\" --description=\"Custom config\"", description: "Save current config as template" },
    ],
    related: ["config"],
  },
  "validate-tokens": {
    tool: "hench",
    command: "validate-tokens",
    summary: "validate Codex token reporting accuracy",
    usage: "hench validate-tokens [options] [dir]",
    description:
      "Validates token reporting across all agent runs, checking for:\n" +
      "  - Non-zero token values in Codex runs\n" +
      "  - Outlier detection (tokens outside expected ranges)\n" +
      "  - Vendor attribution accuracy (Codex vs Claude)\n" +
      "  - Codex and Claude token comparability for similar tasks",
    options: [
      { flag: "--format=json", description: "Output as JSON for scripting" },
      { flag: "--strict", description: "Exit with error code if validation fails" },
      { flag: "--limit=<n>", description: "Validate only N most recent runs (default: 20)" },
      { flag: "--codex-only", description: "Validate only Codex runs" },
    ],
    examples: [
      { command: "hench validate-tokens", description: "Validate all recent runs" },
      { command: "hench validate-tokens --codex-only", description: "Validate only Codex runs" },
      { command: "hench validate-tokens --format=json .", description: "JSON output for analysis" },
      { command: "hench validate-tokens --strict --limit=5", description: "Strict validation of last 5 runs" },
    ],
    related: ["status", "show"],
  },
};

/** Related commands for each hench command (shown as "See also"). */
const RELATED_COMMANDS: Record<string, string[]> = {
  init: ["run", "config"],
  run: ["status", "show"],
  record: ["usage", "status", "show"],
  usage: ["record"],
  status: ["show", "run", "validate-tokens"],
  show: ["status"],
  config: ["template"],
  template: ["config"],
  "validate-tokens": ["status", "show"],
};

/**
 * Get the help text for a command without printing it.
 * Returns null if the command has no dedicated help.
 */
export function getCommandHelp(command: string): string | null {
  const def = COMMAND_DEFS[command];
  if (!def) return null;

  const related = def.related && def.related.length > 0
    ? def.related
    : RELATED_COMMANDS[command];

  const fullDef: HelpDefinition = {
    ...def,
    related: related && related.length > 0 ? related : undefined,
  };

  return formatHelp(fullDef);
}

/**
 * Show command-specific help. Returns true if help was shown, false if
 * the command has no dedicated help.
 */
export function showCommandHelp(command: string): boolean {
  const text = getCommandHelp(command);
  if (!text) return false;
  console.log(text);
  return true;
}
