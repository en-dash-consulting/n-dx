/**
 * Command-specific help content for the sourcevision CLI.
 *
 * Each command has a dedicated help definition that includes:
 *   - Synopsis / usage pattern
 *   - Relevant flags only
 *   - 2–3 practical examples
 *
 * Uses the shared formatHelp() from @n-dx/llm-client for consistent
 * presentation with semantic color coding across all n-dx packages.
 *
 * @module sourcevision/cli/help
 */

import { formatHelp, formatUsage } from "@n-dx/llm-client";
import type { HelpDefinition } from "@n-dx/llm-client";

/** Map of command name → help definition. */
const COMMAND_DEFS: Record<string, HelpDefinition> = {
  init: {
    tool: "sourcevision",
    command: "init",
    summary: "set up .sourcevision/ directory",
    usage: "sourcevision init [dir]",
    description:
      "Creates .sourcevision/ with a manifest.json in the target directory.\n" +
      "If .sourcevision/ already exists, reports it and suggests running analyze.",
    examples: [
      { command: "sourcevision init", description: "Initialize in current directory" },
      { command: "sourcevision init ./my-project", description: "Initialize in a specific directory" },
      { command: "sv init .", description: "Using the 'sv' alias" },
    ],
    related: ["analyze"],
  },
  analyze: {
    tool: "sourcevision",
    command: "analyze",
    summary: "run the analysis pipeline",
    usage: "sourcevision analyze [options] [dir]",
    description:
      "Runs the full four-phase analysis pipeline: inventory, imports, zone\n" +
      "detection, and component cataloging. Generates CONTEXT.md, llms.txt,\n" +
      "and structured JSON data files in .sourcevision/.",
    sections: [
      {
        title: "Phases",
        content:
          "1. Inventory    File listing with metadata and classifications\n" +
          "2. Imports      Dependency graph and import edges\n" +
          "3. Zones        Architectural zone detection (Louvain community detection)\n" +
          "4. Components   React component catalog and prop analysis",
      },
    ],
    options: [
      { flag: "--phase=<N>", description: "Run only phase N (1–4)" },
      { flag: "--only=<module>", description: "Run only a named module: inventory, imports, zones, components" },
      { flag: "--fast", description: "Skip AI zone-name enrichment (algorithmic names only)" },
      { flag: "--full", description: "Run all 4 enrichment passes in sequence" },
      { flag: "--deep", description: "Re-analyze sub-packages before root analysis" },
      { flag: "--per-zone", description: "Per-zone enrichment (smaller context, parallelizable)" },
      { flag: "--quiet, -q", description: "Suppress informational output" },
    ],
    examples: [
      { command: "sourcevision analyze", description: "Full analysis of current directory" },
      { command: "sourcevision analyze --fast .", description: "Skip AI enrichment for speed" },
      { command: "sourcevision analyze --phase=1", description: "Run only the inventory phase" },
      { command: "sv analyze --only=zones .", description: "Re-run zone detection only" },
    ],
    related: ["validate", "serve"],
  },
  serve: {
    tool: "sourcevision",
    command: "serve",
    summary: "start a local viewer server",
    usage: "sourcevision serve [options] [dir]",
    description:
      "Starts an HTTP server to browse the analysis results interactively.\n" +
      "Requires .sourcevision/ to exist (run 'sourcevision init' and\n" +
      "'sourcevision analyze' first).",
    options: [
      { flag: "--port=<N>", description: "Server port (default: 3117)" },
    ],
    examples: [
      { command: "sourcevision serve", description: "Start viewer on default port" },
      { command: "sourcevision serve --port=8080", description: "Start viewer on custom port" },
      { command: "sv serve .", description: "Using the 'sv' alias" },
    ],
    related: ["analyze"],
  },
  validate: {
    tool: "sourcevision",
    command: "validate",
    summary: "validate analysis output files",
    usage: "sourcevision validate [dir]",
    description:
      "Checks that .sourcevision/ contains valid manifest.json and data files.\n" +
      "Useful for CI pipelines to ensure analysis output is consistent.",
    examples: [
      { command: "sourcevision validate", description: "Validate current directory" },
      { command: "sourcevision validate ./project", description: "Validate a specific project" },
      { command: "sv validate .", description: "Using the 'sv' alias" },
    ],
    related: ["analyze"],
  },
  reset: {
    tool: "sourcevision",
    command: "reset",
    summary: "remove .sourcevision/ and start fresh",
    usage: "sourcevision reset [dir]",
    description:
      "Deletes the entire .sourcevision/ directory. Use this when you want\n" +
      "a clean re-analysis or when troubleshooting stale data.",
    examples: [
      { command: "sourcevision reset", description: "Reset current directory" },
      { command: "sourcevision reset ./project", description: "Reset a specific project" },
      { command: "sv reset .", description: "Using the 'sv' alias" },
    ],
    related: ["init"],
  },
  "export-pdf": {
    tool: "sourcevision",
    command: "export-pdf",
    summary: "export analysis as PDF report",
    usage: "sourcevision export-pdf [options] [dir]",
    description:
      "Generates a PDF report from the analysis data. Requires .sourcevision/\n" +
      "to exist with completed analysis.",
    options: [
      { flag: "--output=<path>", description: "Output file path (default: .sourcevision/report.pdf)" },
    ],
    examples: [
      { command: "sourcevision export-pdf", description: "Export to default location" },
      { command: "sourcevision export-pdf --output=report.pdf", description: "Custom output path" },
      { command: "sv export-pdf .", description: "Using the 'sv' alias" },
    ],
    related: ["analyze"],
  },
  "pr-markdown": {
    tool: "sourcevision",
    command: "pr-markdown",
    summary: "regenerate pull-request markdown on demand",
    usage: "sourcevision pr-markdown [dir]",
    description:
      "Generates PR-ready markdown from git diff metadata and writes it to\n" +
      ".sourcevision/pr-markdown.md in the target directory.",
    sections: [
      {
        title: "Output",
        content: ".sourcevision/pr-markdown.md",
      },
    ],
    examples: [
      { command: "sourcevision pr-markdown", description: "Regenerate markdown in current directory" },
      { command: "sourcevision pr-markdown ./project", description: "Regenerate markdown for a specific project" },
      { command: "sv pr-markdown .", description: "Using the 'sv' alias" },
    ],
    related: ["serve", "git-credential-helper"],
  },
  "git-credential-helper": {
    tool: "sourcevision",
    command: "git-credential-helper",
    summary: "run interactive GitHub credential setup",
    usage: "sourcevision git-credential-helper",
    description:
      "Checks GitHub CLI auth state (`gh auth status`). If unauthenticated,\n" +
      "hands off to `gh auth login`. If `gh` is unavailable, shows platform\n" +
      "credential-manager guidance for git remote operations.",
    examples: [
      { command: "sourcevision git-credential-helper", description: "Start interactive GitHub auth setup" },
    ],
    related: ["pr-markdown"],
  },
  mcp: {
    tool: "sourcevision",
    command: "mcp",
    summary: "start MCP server for AI tool integration",
    usage: "sourcevision mcp [dir]",
    description:
      "Starts a Model Context Protocol (MCP) server over stdio for integration\n" +
      "with AI coding assistants. Exposes tools for querying the codebase:\n" +
      "inventory, imports, zones, components, and full context.",
    examples: [
      { command: "sourcevision mcp", description: "Start MCP server in current directory" },
      { command: "sourcevision mcp /path/to/proj", description: "Start MCP server for a specific project" },
      { command: "sv mcp .", description: "Using the 'sv' alias" },
    ],
    related: [],
  },
  workspace: {
    tool: "sourcevision",
    command: "workspace",
    summary: "aggregate multiple analyzed repos into a unified view",
    usage: "sourcevision workspace [options] [dir]",
    description:
      "Aggregates pre-analyzed repositories into a unified .sourcevision/ output.\n" +
      "Each member repo must already have .sourcevision/ from a prior analysis run.\n" +
      "Members are configured in .n-dx.json or auto-detected from nested\n" +
      ".sourcevision/ directories.",
    options: [
      { flag: "--add <dir>", description: "Add a directory as a workspace member (persists to .n-dx.json)" },
      { flag: "--remove <dir>", description: "Remove a workspace member" },
      { flag: "--status", description: "List members with analysis freshness, zone counts, file counts" },
      { flag: "--quiet, -q", description: "Suppress informational output" },
    ],
    examples: [
      { command: "sourcevision workspace --add packages/api --add packages/web .", description: "Add workspace members" },
      { command: "sourcevision workspace .", description: "Run workspace aggregation" },
      { command: "sourcevision workspace --status .", description: "Check member status" },
      { command: "sv workspace .", description: "Using the 'sv' alias" },
    ],
    related: ["analyze", "validate"],
  },
};

/** Related commands for each sourcevision command (shown as "See also"). */
const RELATED_COMMANDS: Record<string, string[]> = {
  init: ["analyze"],
  analyze: ["validate", "serve"],
  serve: ["analyze"],
  validate: ["analyze"],
  reset: ["init"],
  "export-pdf": ["analyze"],
  "pr-markdown": ["serve", "git-credential-helper"],
  "git-credential-helper": ["pr-markdown"],
  mcp: [],
  workspace: ["analyze", "validate"],
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
 * Print top-level usage (all commands) to stdout.
 */
export function usage(): void {
  console.log(formatUsage({
    title: "sourcevision — codebase analysis tool",
    usage: "sourcevision <command> [options] [dir]",
    sections: [
      {
        title: "Commands",
        items: [
          { name: "sourcevision init [dir]", description: "Set up .sourcevision/ in the current project" },
          { name: "sourcevision analyze [dir]", description: "Run analysis pipeline (default: .)" },
          { name: "sourcevision serve [dir]", description: "Start local viewer (default: .)" },
          { name: "sourcevision validate [dir]", description: "Validate .sourcevision/ output files" },
          { name: "sourcevision export-pdf [dir]", description: "Export analysis as a PDF report" },
          { name: "sourcevision pr-markdown [dir]", description: "Regenerate PR markdown at .sourcevision/pr-markdown.md" },
          { name: "sourcevision git-credential-helper", description: "Run interactive GitHub credential setup helper" },
          { name: "sourcevision reset [dir]", description: "Remove .sourcevision/ and start fresh" },
          { name: "sourcevision workspace [dir]", description: "Aggregate multiple analyzed repos into a unified view" },
          { name: "sourcevision mcp [dir]", description: "Start MCP server for AI tool integration" },
        ],
      },
    ],
    options: [
      { flag: "--help, -h", description: "Show this help" },
      { flag: "--quiet, -q", description: "Suppress informational output (for scripting)" },
    ],
    footer: [
      "Run 'sourcevision <command> --help' for detailed help on any command.",
      "Alias: 'sv' works in place of 'sourcevision'.",
    ],
  }));
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
