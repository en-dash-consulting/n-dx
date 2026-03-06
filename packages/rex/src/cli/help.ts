/**
 * Command-specific help content for the rex CLI.
 *
 * Each command has a dedicated help definition that includes:
 *   - Synopsis / usage pattern
 *   - Relevant flags only (not the full global options list)
 *   - 2–3 practical examples
 *
 * Uses the shared formatHelp() from @n-dx/llm-client for consistent
 * presentation with semantic color coding across all n-dx packages.
 *
 * @module rex/cli/help
 */

import { formatHelp } from "@n-dx/llm-client";
import type { HelpDefinition } from "@n-dx/llm-client";

/** Map of command name → help definition. */
const COMMAND_DEFS: Record<string, HelpDefinition> = {
  init: {
    tool: "rex",
    command: "init",
    summary: "initialize a .rex/ directory",
    usage: "rex init [dir]",
    description:
      "Sets up .rex/ with config.json, prd.json, and workflow.md in the target\n" +
      "directory (defaults to the current directory).",
    options: [
      { flag: "--project=<name>", description: "Project name for config (default: directory basename)" },
      { flag: "--analyze", description: "Also run SourceVision analysis after init" },
    ],
    examples: [
      { command: "rex init", description: "Initialize in current directory" },
      { command: "rex init ./my-project", description: "Initialize in a specific directory" },
      { command: "rex init --analyze .", description: "Initialize and analyze codebase" },
    ],
    related: ["status", "analyze"],
  },
  status: {
    tool: "rex",
    command: "status",
    summary: "show PRD tree with completion stats",
    usage: "rex status [options] [dir]",
    description:
      "Displays the full PRD hierarchy with status icons, progress bars, and\n" +
      "optional token usage summary. Completed subtrees and deleted items are\n" +
      "hidden by default.",
    options: [
      { flag: "--all", description: "Show all items including completed and deleted ones" },
      { flag: "--coverage", description: "Show test coverage per task" },
      { flag: "--tokens=false", description: "Hide token usage summary (shown by default)" },
      { flag: "--since=<ISO>", description: "Filter token usage after this timestamp" },
      { flag: "--until=<ISO>", description: "Filter token usage before this timestamp" },
      { flag: "--format=tree|json", description: "Output format (default: tree)" },
      { flag: "--group-by=<facet>", description: "Group items by facet value instead of hierarchy" },
      { flag: "--stale", description: "Show only stale items (in_progress > 48h)" },
    ],
    examples: [
      { command: "rex status", description: "Show PRD tree (hides completed)" },
      { command: "rex status --all", description: "Show everything including completed and deleted items" },
      { command: "rex status --group-by=component", description: "Group items by component facet" },
      { command: "rex status --stale", description: "Show stale in-progress items" },
      { command: "rex status --format=json .", description: "Machine-readable JSON output" },
    ],
    related: ["next", "usage"],
  },
  next: {
    tool: "rex",
    command: "next",
    summary: "print the next actionable task",
    usage: "rex next [options] [dir]",
    description:
      "Finds the highest-priority task that is ready to work on (not blocked,\n" +
      "not deferred). Shows the task with its parent chain and explains why\n" +
      "it was selected.",
    options: [
      { flag: "--format=json", description: "Output as JSON" },
    ],
    examples: [
      { command: "rex next", description: "Show next task to work on" },
      { command: "rex next --format=json .", description: "Machine-readable output for scripting" },
    ],
    related: ["status", "update"],
  },
  add: {
    tool: "rex",
    command: "add",
    summary: "add items to the PRD",
    usage: [
      "rex add <level> --title=\"...\" [options] [dir]",
      "rex add \"<description>\" [\"<desc2>\" ...] [dir]",
      "rex add --file=<path> [dir]",
      "echo \"description\" | rex add [dir]",
    ],
    description:
      "Manual mode creates a single item at the specified level. Smart mode\n" +
      "uses an LLM to analyze your description(s) and generate a structured\n" +
      "PRD proposal with epics, features, tasks, and subtasks.\n" +
      "In interactive smart mode, rex prompts for duplicate handling only when\n" +
      "selected proposal nodes match existing PRD items.",
    sections: [
      { title: "Levels", content: "epic, feature, task, subtask" },
      {
        title: "Duplicate handling (smart mode)",
        content:
          "Prompt: Duplicate action (c/m/p)\n" +
          "c=cancel: abort write, create nothing\n" +
          "m=merge: update matched existing items and add only non-duplicates\n" +
          "p=proceed anyway: create duplicates and persist override markers\n" +
          "Empty/invalid input defaults to cancel.",
      },
    ],
    options: [
      { flag: "--title=\"...\"", description: "Item title (required for manual mode)", required: true },
      { flag: "--level=<level>", description: "Item level (alternative to positional level)" },
      { flag: "--parent=<id>", description: "Parent item ID to nest under" },
      { flag: "--priority=<p>", description: "Priority: critical, high, medium, low" },
      { flag: "--description=\"...\"", description: "Item description" },
      { flag: "--file=<path>", description: "Import from a freeform text file (repeatable)" },
      { flag: "--accept", description: "Auto-accept LLM proposals without review" },
      { flag: "--model=<name>", description: "Override LLM model for smart mode" },
    ],
    examples: [
      { command: "rex add epic --title=\"User auth\"", description: "Add an epic manually" },
      { command: "rex add task --title=\"Login form\" --parent=abc", description: "Add a task under a parent" },
      { command: "rex add \"Add dark mode support\"", description: "Smart add from description" },
      { command: "rex add --file=ideas.txt --file=notes.md .", description: "Import from multiple files" },
    ],
    related: ["analyze", "update"],
  },
  update: {
    tool: "rex",
    command: "update",
    summary: "update an existing PRD item",
    usage: "rex update <id> [options] [dir]",
    description:
      "Modify the status, priority, title, or description of a PRD item.\n" +
      "Status transitions are validated (e.g. completed → pending requires --force).",
    options: [
      { flag: "--status=<s>", description: "New status: pending, in_progress, completed, failing, deferred, blocked, deleted" },
      { flag: "--priority=<p>", description: "New priority: critical, high, medium, low" },
      { flag: "--title=\"...\"", description: "New title" },
      { flag: "--description=\"...\"", description: "New description" },
      { flag: "--reason=\"...\"", description: "Failure reason (when setting status to failing)" },
      { flag: "--force", description: "Override status transition rules" },
    ],
    examples: [
      { command: "rex update abc123 --status=completed", description: "Mark a task as done" },
      { command: "rex update abc123 --status=in_progress", description: "Start working on a task" },
      { command: "rex update abc123 --priority=critical --title=\"Urgent fix\"", description: "Update priority and title" },
    ],
    related: ["add", "next"],
  },
  remove: {
    tool: "rex",
    command: "remove",
    summary: "remove an epic or task from the PRD",
    usage: [
      "rex remove epic <id> [dir]",
      "rex remove task <id> [dir]",
      "rex remove <id> [dir]",
    ],
    description:
      "Permanently removes an epic or task and all its descendants from the PRD tree.\n" +
      "When the level (epic/task) is omitted, it is auto-detected from the item.\n" +
      "An interactive confirmation prompt is shown before deletion (unless --yes\n" +
      "is passed or output is piped). Cleans up blockedBy references on remaining\n" +
      "items and detects parent auto-completions.\n" +
      "\n" +
      "WARNING: Removal is irreversible. Deleted items and all their descendants\n" +
      "are permanently erased from prd.json. Use 'rex status' to verify IDs and\n" +
      "review the subtree before removing.",
    sections: [
      {
        title: "Epic vs task removal",
        content:
          "epic    Deletes the epic and its entire subtree (features, tasks,\n" +
          "        and subtasks). Use when an initiative is cancelled or obsolete.\n" +
          "task    Deletes the task and its subtasks only. The parent feature\n" +
          "        and epic remain intact. If removing the task causes all\n" +
          "        siblings to be completed, the parent is auto-completed.\n" +
          "\n" +
          "Features and subtasks cannot be removed directly. Remove the\n" +
          "parent epic or task instead, or use 'rex prune' for completed\n" +
          "subtrees.",
      },
    ],
    options: [
      { flag: "--yes, -y", description: "Skip confirmation prompt (use in scripts)" },
      { flag: "--format=json", description: "Machine-readable output" },
    ],
    examples: [
      { command: "rex remove epic abc123", description: "Remove an epic and all descendants" },
      { command: "rex remove task def456", description: "Remove a task and its subtasks" },
      { command: "rex remove abc123", description: "Auto-detect level and remove" },
      { command: "rex remove task def456 --yes", description: "Remove without confirmation (scripting)" },
    ],
    related: ["update", "prune"],
  },
  move: {
    tool: "rex",
    command: "move",
    summary: "reparent an item in the PRD tree",
    usage: "rex move <id> [options] [dir]",
    description:
      "Moves an item to a new parent, changing its position in the PRD hierarchy.\n" +
      "Validates that the move doesn't create cycles or violate level constraints.",
    options: [
      { flag: "--parent=<id>", description: "New parent ID (omit to move to root)" },
    ],
    examples: [
      { command: "rex move abc123 --parent=def456", description: "Move item under a new parent" },
      { command: "rex move abc123", description: "Move item to root level" },
    ],
    related: ["reshape"],
  },
  reshape: {
    tool: "rex",
    command: "reshape",
    summary: "LLM-powered PRD restructuring",
    usage: "rex reshape [options] [dir]",
    description:
      "Uses an LLM to analyze the current PRD and propose structural changes:\n" +
      "merges, splits, reparenting, title updates, and description improvements.",
    options: [
      { flag: "--dry-run", description: "Preview proposals without applying" },
      { flag: "--accept", description: "Auto-accept proposals without review" },
      { flag: "--model=<name>", description: "Override LLM model" },
    ],
    examples: [
      { command: "rex reshape", description: "Interactive review of proposals" },
      { command: "rex reshape --dry-run", description: "Preview what would change" },
      { command: "rex reshape --accept .", description: "Apply all proposals automatically" },
    ],
    related: ["prune", "move"],
  },
  prune: {
    tool: "rex",
    command: "prune",
    summary: "remove completed subtrees",
    usage: "rex prune [options] [dir]",
    description:
      "Removes fully-completed branches from the PRD tree and archives them\n" +
      "to .rex/archive.json. Optionally runs a consolidation pass to clean\n" +
      "up remaining items.",
    options: [
      { flag: "--dry-run", description: "Preview what would be pruned" },
      { flag: "--smart", description: "Use LLM-assisted consolidation after pruning" },
      { flag: "--accept", description: "Auto-accept all changes without review" },
      { flag: "--yes, -y", description: "Skip confirmation prompt" },
      { flag: "--no-consolidate", description: "Skip the post-prune consolidation pass" },
    ],
    examples: [
      { command: "rex prune", description: "Interactive prune with confirmation" },
      { command: "rex prune --dry-run", description: "Preview pruneable items" },
      { command: "rex prune --smart --yes .", description: "Smart prune without prompts" },
    ],
    related: ["reshape", "status"],
  },
  validate: {
    tool: "rex",
    command: "validate",
    summary: "check PRD integrity",
    usage: "rex validate [options] [dir]",
    description:
      "Runs schema validation, DAG cycle detection, and structural checks\n" +
      "against .rex/prd.json and config.json.",
    options: [
      { flag: "--format=json", description: "Machine-readable output" },
    ],
    examples: [
      { command: "rex validate", description: "Check PRD health" },
      { command: "rex validate --format=json .", description: "JSON output for CI integration" },
    ],
    related: ["fix", "report"],
  },
  fix: {
    tool: "rex",
    command: "fix",
    summary: "auto-fix common PRD issues",
    usage: "rex fix [options] [dir]",
    description:
      "Detects and repairs common validation issues such as missing timestamps,\n" +
      "broken parent references, and inconsistent status values.",
    options: [
      { flag: "--dry-run", description: "Preview fixes without applying" },
      { flag: "--format=json", description: "Machine-readable output" },
    ],
    examples: [
      { command: "rex fix", description: "Fix all detected issues" },
      { command: "rex fix --dry-run", description: "Preview what would be fixed" },
      { command: "rex fix --format=json .", description: "JSON output for scripting" },
    ],
    related: ["validate"],
  },
  sync: {
    tool: "rex",
    command: "sync",
    summary: "synchronize PRD with a remote adapter",
    usage: "rex sync [options] [dir]",
    description:
      "Bidirectional sync between the local .rex/prd.json and a remote service\n" +
      "(e.g. Notion). By default performs a full sync; use --push or --pull\n" +
      "for one-way operations.",
    options: [
      { flag: "--push", description: "Push local changes to remote only" },
      { flag: "--pull", description: "Pull remote changes to local only" },
      { flag: "--adapter=<name>", description: "Adapter name (default: notion)" },
      { flag: "--dry-run", description: "Preview sync without writing" },
      { flag: "--format=json", description: "Machine-readable output" },
    ],
    examples: [
      { command: "rex sync", description: "Full bidirectional sync" },
      { command: "rex sync --push", description: "Push local changes to Notion" },
      { command: "rex sync --pull --adapter=notion", description: "Pull remote changes down" },
    ],
    related: ["adapter"],
  },
  usage: {
    tool: "rex",
    command: "usage",
    summary: "token usage analytics and cost estimation",
    usage: "rex usage [options] [dir]",
    description:
      "Shows detailed token consumption across all LLM operations, grouped\n" +
      "by command or time period, with cost estimates.",
    options: [
      { flag: "--group=day|week|month", description: "Group usage by time period" },
      { flag: "--since=<ISO>", description: "Filter usage after this timestamp" },
      { flag: "--until=<ISO>", description: "Filter usage before this timestamp" },
      { flag: "--format=tree|json", description: "Output format (default: tree)" },
    ],
    examples: [
      { command: "rex usage", description: "Show total token usage" },
      { command: "rex usage --group=week", description: "Usage grouped by week" },
      { command: "rex usage --since=2025-01-01 --format=json", description: "Filtered JSON output" },
    ],
    related: ["status"],
  },
  report: {
    tool: "rex",
    command: "report",
    summary: "generate JSON health report",
    usage: "rex report [options] [dir]",
    description:
      "Produces a structured health report including validation results,\n" +
      "level breakdowns, and completion stats. Designed for CI dashboards.",
    options: [
      { flag: "--fail-on-error", description: "Exit 1 if validation errors are found" },
      { flag: "--format=json", description: "Always outputs JSON (this flag is implicit)" },
    ],
    examples: [
      { command: "rex report", description: "Generate health report" },
      { command: "rex report --fail-on-error .", description: "Fail CI on validation errors" },
    ],
    related: ["validate"],
  },
  verify: {
    tool: "rex",
    command: "verify",
    summary: "run tests for acceptance criteria",
    usage: "rex verify [options] [dir]",
    description:
      "Maps acceptance criteria to test files and optionally executes tests\n" +
      "to validate task completion.",
    options: [
      { flag: "--task=<id>", description: "Verify a specific task only" },
      { flag: "--dry-run", description: "Map criteria to tests without running them" },
      { flag: "--format=json", description: "Machine-readable output" },
    ],
    examples: [
      { command: "rex verify", description: "Verify all tasks" },
      { command: "rex verify --task=abc123", description: "Verify a specific task" },
      { command: "rex verify --dry-run .", description: "Preview test mapping without execution" },
    ],
    related: ["status"],
  },
  recommend: {
    tool: "rex",
    command: "recommend",
    summary: "get SourceVision-based recommendations",
    usage: "rex recommend [options] [dir]",
    description:
      "Reads SourceVision analysis findings and suggests new PRD items based on\n" +
      "code quality issues, architectural anti-patterns, and missing tests.\n" +
      "Requires .sourcevision/ to exist (run 'sourcevision analyze' first).\n" +
      "\n" +
      "Two workflows are available: acknowledge (suppress findings from future\n" +
      "output) and accept (create PRD items from recommendations).",
    sections: [
      {
        title: "Acknowledge vs accept",
        content:
          "--acknowledge    Marks findings as seen. Acknowledged findings are\n" +
          "                hidden from subsequent runs (use --show-all to\n" +
          "                reveal them). No PRD items are created.\n" +
          "--accept        Creates new PRD items from the recommendations.\n" +
          "                Each recommendation becomes a feature in the PRD\n" +
          "                with its findings as the description. Conflict\n" +
          "                detection prevents duplicate items.",
      },
      {
        title: "Selector syntax (--accept)",
        content:
          "--accept              Accept all recommendations (no selector)\n" +
          "--accept==all         Accept all recommendations (explicit)\n" +
          "--accept==.           Accept all recommendations (dot wildcard)\n" +
          "--accept==3           Accept only recommendation 3\n" +
          "--accept==1,4,5       Accept recommendations 1, 4, and 5\n" +
          "\n" +
          "Indices are 1-based and correspond to the numbered output shown\n" +
          "by 'rex recommend'. Range syntax (e.g. 1-3) is not supported;\n" +
          "use comma-separated indices instead.",
      },
    ],
    options: [
      { flag: "--accept[=all|=1,4,5]", description: "Accept all or selected recommendations into PRD as new items" },
      { flag: "--force", description: "Create items even when conflicts with existing PRD items are detected" },
      { flag: "--show-all", description: "Include acknowledged findings in recommendation output" },
      { flag: "--acknowledge=<all|1,2>", description: "Acknowledge all or selected findings by index (hides from future runs)" },
      { flag: "--format=json", description: "Machine-readable output" },
    ],
    examples: [
      { command: "rex recommend", description: "Show recommendations (run first to see indices)" },
      { command: "rex recommend --accept", description: "Accept all recommendations into PRD" },
      { command: "rex recommend --accept==3", description: "Accept only recommendation 3" },
      { command: "rex recommend --accept==1,4,5 .", description: "Accept recommendations 1, 4, and 5" },
      { command: "rex recommend --accept==all --force", description: "Accept all, overriding conflicts" },
      { command: "rex recommend --acknowledge=all", description: "Acknowledge all findings (no PRD changes)" },
      { command: "rex recommend --show-all", description: "Include previously acknowledged findings" },
      { command: "rex recommend --format=json .", description: "JSON output for automation" },
    ],
    related: ["analyze", "status"],
  },
  analyze: {
    tool: "rex",
    command: "analyze",
    summary: "build PRD from project analysis",
    usage: "rex analyze [options] [dir]",
    description:
      "Scans the codebase (tests, docs, SourceVision output, package.json) and\n" +
      "uses an LLM to generate PRD proposals. Proposals are reviewed interactively\n" +
      "unless --accept is passed.\n" +
      "\n" +
      "Also available as: rex import",
    options: [
      { flag: "--accept", description: "Accept all proposals without review" },
      { flag: "--lite", description: "File-name-only scan (faster, less detail)" },
      { flag: "--guided", description: "Interactive spec builder for new projects" },
      { flag: "--no-llm", description: "Force algorithmic pipeline, skip LLM" },
      { flag: "--model=<name>", description: "Override LLM model" },
      { flag: "--file=<path>", description: "Import from a document (repeatable)" },
      { flag: "--chunk-size=<n>", description: "Proposals per page in interactive review" },
    ],
    examples: [
      { command: "rex analyze", description: "Scan and review proposals interactively" },
      { command: "rex analyze --accept .", description: "Auto-accept all proposals" },
      { command: "rex analyze --file=spec.md", description: "Generate PRD from a spec document" },
      { command: "rex analyze --guided", description: "Guided setup for a new project" },
    ],
    related: ["add", "recommend"],
  },
  adapter: {
    tool: "rex",
    command: "adapter",
    summary: "manage store adapters",
    usage: "rex adapter <subcommand> [name] [options] [dir]",
    sections: [
      {
        title: "Subcommands",
        content:
          "list                List registered adapters and their status\n" +
          "add <name>          Configure an adapter (e.g. notion)\n" +
          "remove <name>       Remove adapter configuration\n" +
          "show <name>         Show adapter configuration details",
      },
    ],
    options: [
      { flag: "--key=<value>", description: "Set adapter config values (for add)" },
      { flag: "--format=json", description: "Machine-readable output (for list, show)" },
    ],
    examples: [
      { command: "rex adapter list", description: "Show all adapters" },
      { command: "rex adapter add notion --token=secret_xxx", description: "Configure Notion adapter" },
      { command: "rex adapter show notion", description: "Show Notion config" },
    ],
    related: ["sync"],
  },
  reorganize: {
    tool: "rex",
    command: "reorganize",
    summary: "detect and fix structural issues in the PRD",
    usage: "rex reorganize [options] [dir]",
    description:
      "Analyzes the PRD tree using both programmatic detectors and LLM reasoning.\n" +
      "Programmatic: orphaned features, near-duplicates, oversized/undersized containers.\n" +
      "LLM: semantic merge, update, reparent, split, and obsolete proposals.\n" +
      "Use --fast to skip LLM analysis for quick structural checks only.",
    options: [
      { flag: "--accept", description: "Apply all low-risk structural proposals" },
      { flag: "--accept=<ids>", description: "Apply specific structural proposals by ID (comma-separated)" },
      { flag: "--accept=all", description: "Apply structural (low-risk) + all LLM proposals" },
      { flag: "--accept-llm", description: "Apply all LLM proposals" },
      { flag: "--accept-llm=<ids>", description: "Apply specific LLM proposals by display index" },
      { flag: "--fast", description: "Programmatic analysis only (no LLM call)" },
      { flag: "--model=<model>", description: "LLM model to use for analysis" },
      { flag: "--include-completed", description: "Include completed items in similarity analysis" },
      { flag: "--format=json", description: "Machine-readable output" },
    ],
    examples: [
      { command: "rex reorganize", description: "Detect issues and show all proposals" },
      { command: "rex reorganize --fast", description: "Structural analysis only (no LLM)" },
      { command: "rex reorganize --accept", description: "Apply low-risk structural proposals" },
      { command: "rex reorganize --accept-llm", description: "Apply all LLM proposals" },
      { command: "rex reorganize --accept=all", description: "Apply structural + LLM proposals" },
      { command: "rex reorganize --accept-llm=1,3", description: "Apply LLM proposals 1 and 3" },
    ],
    related: ["health", "prune", "reshape"],
  },
  health: {
    tool: "rex",
    command: "health",
    summary: "show structure health score",
    usage: "rex health [options] [dir]",
    description:
      "Computes a multi-dimensional health score (0–100) for the PRD structure.\n" +
      "Evaluates depth (items at correct nesting), balance (even distribution),\n" +
      "granularity (task quality), completeness (metadata coverage), and\n" +
      "staleness (stale in-progress items). Includes up to 3 improvement suggestions.",
    options: [
      { flag: "--format=json", description: "Machine-readable output" },
    ],
    examples: [
      { command: "rex health", description: "Show health score with dimension breakdown" },
      { command: "rex health --format=json .", description: "JSON output for CI dashboards" },
    ],
    related: ["reorganize", "report", "validate"],
  },
  mcp: {
    tool: "rex",
    command: "mcp",
    summary: "start MCP server for AI tool integration",
    usage: "rex mcp [dir]",
    description:
      "Starts a Model Context Protocol (MCP) server over stdio for integration\n" +
      "with AI coding assistants like Claude Code. Exposes tools for PRD\n" +
      "management: status, next task, add, update, validate, analyze, recommend.",
    examples: [
      { command: "rex mcp", description: "Start MCP server in current directory" },
      { command: "rex mcp /path/to/project", description: "Start MCP server for a specific project" },
    ],
    related: [],
  },
};

// Point the import alias at analyze's definition
COMMAND_DEFS["import"] = COMMAND_DEFS["analyze"];

/** Related commands for each rex command (shown as "See also"). */
const RELATED_COMMANDS: Record<string, string[]> = {
  init: ["status", "analyze"],
  status: ["next", "usage"],
  next: ["status", "update"],
  add: ["analyze", "update"],
  update: ["add", "next"],
  remove: ["update", "prune"],
  move: ["reshape"],
  reshape: ["prune", "move"],
  prune: ["reshape", "status"],
  validate: ["fix", "report"],
  fix: ["validate"],
  sync: ["adapter"],
  usage: ["status"],
  report: ["validate"],
  verify: ["status"],
  recommend: ["analyze", "status"],
  analyze: ["add", "recommend"],
  import: ["add", "recommend"],
  adapter: ["sync"],
  reorganize: ["health", "prune", "reshape"],
  health: ["reorganize", "report", "validate"],
  mcp: [],
};

/**
 * Get the help text for a command without printing it.
 * Returns null if the command has no dedicated help.
 */
export function getCommandHelp(command: string): string | null {
  const def = COMMAND_DEFS[command];
  if (!def) return null;

  // Use the definition's related commands, falling back to the RELATED_COMMANDS map
  const related = def.related && def.related.length > 0
    ? def.related
    : RELATED_COMMANDS[command];

  // Build a copy with the related commands resolved
  const fullDef: HelpDefinition = {
    ...def,
    related: related && related.length > 0 ? related : undefined,
  };

  return formatHelp(fullDef);
}

/**
 * Show command-specific help. Returns true if help was shown, false if
 * the command has no dedicated help (caller should fall back to general usage).
 */
export function showCommandHelp(command: string): boolean {
  const text = getCommandHelp(command);
  if (!text) return false;
  console.log(text);
  return true;
}
