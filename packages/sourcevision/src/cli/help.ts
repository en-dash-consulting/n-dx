/**
 * Command-specific help content for the sourcevision CLI.
 *
 * Each command has a dedicated help function that shows:
 *   - Synopsis / usage pattern
 *   - Relevant flags only
 *   - 2–3 practical examples
 *
 * @module sourcevision/cli/help
 */

/** Map of command name → help renderer. */
const COMMAND_HELP: Record<string, () => void> = {
  init: helpInit,
  analyze: helpAnalyze,
  serve: helpServe,
  validate: helpValidate,
  reset: helpReset,
  "export-pdf": helpExportPdf,
  mcp: helpMcp,
};

/**
 * Show command-specific help. Returns true if help was shown, false if
 * the command has no dedicated help.
 */
export function showCommandHelp(command: string): boolean {
  const fn = COMMAND_HELP[command];
  if (!fn) return false;
  fn();
  return true;
}

// ── Per-command help ──────────────────────────────────────────────────

function helpInit(): void {
  console.log(`sourcevision init — set up .sourcevision/ directory

Usage: sourcevision init [dir]

Creates .sourcevision/ with a manifest.json in the target directory.
If .sourcevision/ already exists, reports it and suggests running analyze.

Examples:
  sourcevision init                Initialize in current directory
  sourcevision init ./my-project   Initialize in a specific directory
  sv init .                        Using the 'sv' alias
`);
}

function helpAnalyze(): void {
  console.log(`sourcevision analyze — run the analysis pipeline

Usage: sourcevision analyze [options] [dir]

Runs the full four-phase analysis pipeline: inventory, imports, zone
detection, and component cataloging. Generates CONTEXT.md, llms.txt,
and structured JSON data files in .sourcevision/.

Phases:
  1. Inventory    File listing with metadata and classifications
  2. Imports      Dependency graph and import edges
  3. Zones        Architectural zone detection (Louvain community detection)
  4. Components   React component catalog and prop analysis

Options:
  --phase=<N>         Run only phase N (1–4)
  --only=<module>     Run only a named module: inventory, imports, zones,
                      components
  --fast              Skip AI zone-name enrichment (algorithmic names only)
  --full              Run all 4 enrichment passes in sequence
  --per-zone          Per-zone enrichment (smaller context, parallelizable)
  --quiet, -q         Suppress informational output

Examples:
  sourcevision analyze             Full analysis of current directory
  sourcevision analyze --fast .    Skip AI enrichment for speed
  sourcevision analyze --phase=1   Run only the inventory phase
  sv analyze --only=zones .        Re-run zone detection only
`);
}

function helpServe(): void {
  console.log(`sourcevision serve — start a local viewer server

Usage: sourcevision serve [options] [dir]

Starts an HTTP server to browse the analysis results interactively.
Requires .sourcevision/ to exist (run 'sourcevision init' and
'sourcevision analyze' first).

Options:
  --port=<N>          Server port (default: 3117)

Examples:
  sourcevision serve               Start viewer on default port
  sourcevision serve --port=8080   Start viewer on custom port
  sv serve .                       Using the 'sv' alias
`);
}

function helpValidate(): void {
  console.log(`sourcevision validate — validate analysis output files

Usage: sourcevision validate [dir]

Checks that .sourcevision/ contains valid manifest.json and data files.
Useful for CI pipelines to ensure analysis output is consistent.

Examples:
  sourcevision validate            Validate current directory
  sourcevision validate ./project  Validate a specific project
  sv validate .                    Using the 'sv' alias
`);
}

function helpReset(): void {
  console.log(`sourcevision reset — remove .sourcevision/ and start fresh

Usage: sourcevision reset [dir]

Deletes the entire .sourcevision/ directory. Use this when you want
a clean re-analysis or when troubleshooting stale data.

Examples:
  sourcevision reset               Reset current directory
  sourcevision reset ./project     Reset a specific project
  sv reset .                       Using the 'sv' alias
`);
}

function helpExportPdf(): void {
  console.log(`sourcevision export-pdf — export analysis as PDF report

Usage: sourcevision export-pdf [options] [dir]

Generates a PDF report from the analysis data. Requires .sourcevision/
to exist with completed analysis.

Options:
  --output=<path>     Output file path (default: .sourcevision/report.pdf)

Examples:
  sourcevision export-pdf                       Export to default location
  sourcevision export-pdf --output=report.pdf   Custom output path
  sv export-pdf .                               Using the 'sv' alias
`);
}

function helpMcp(): void {
  console.log(`sourcevision mcp — start MCP server for AI tool integration

Usage: sourcevision mcp [dir]

Starts a Model Context Protocol (MCP) server over stdio for integration
with AI coding assistants. Exposes tools for querying the codebase:
inventory, imports, zones, components, and full context.

Examples:
  sourcevision mcp                 Start MCP server in current directory
  sourcevision mcp /path/to/proj   Start MCP server for a specific project
  sv mcp .                         Using the 'sv' alias
`);
}
