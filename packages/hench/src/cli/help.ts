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
      { flag: "--dry-run", description: "Print the task brief without calling Claude" },
      { flag: "--review", description: "Show proposed changes and prompt for approval" },
      { flag: "--max-turns=<n>", description: "Override max agent turns per task" },
      { flag: "--token-budget=<n>", description: "Cap total tokens per run (0 = unlimited)" },
      { flag: "--model=<model>", description: "Override the Claude model" },
    ],
    examples: [
      { command: "hench run", description: "Run next task (interactive selection)" },
      { command: "hench run --task=abc123", description: "Run a specific task" },
      { command: "hench run --epic=\"Auth\" --auto", description: "Auto-run tasks in the Auth epic" },
      { command: "hench run --loop --epic-by-epic", description: "Continuously process epics in order" },
      { command: "hench run --dry-run .", description: "Preview the brief without execution" },
    ],
    related: ["status", "show"],
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
    ],
    examples: [
      { command: "hench show abc123", description: "Show run details" },
      { command: "hench show abc123 --format=json", description: "JSON output for scripting" },
    ],
    related: ["status"],
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
      { command: "hench config model claude-sonnet-4-6", description: "Set the model" },
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
};

/** Related commands for each hench command (shown as "See also"). */
const RELATED_COMMANDS: Record<string, string[]> = {
  init: ["run", "config"],
  run: ["status", "show"],
  status: ["show", "run"],
  show: ["status"],
  config: ["template"],
  template: ["config"],
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
