/**
 * Help navigation, typo correction, and search utilities for n-dx CLI.
 *
 * Provides:
 *   - Hierarchical navigation with drill-down hints
 *   - Typo correction via Levenshtein edit distance
 *   - Keyword search across all help content with relevance scoring
 *   - Related command suggestions ("See also")
 *   - Consistent visual formatting with semantic color coding
 *
 * ## Color support
 *
 * Respects NO_COLOR (https://no-color.org/) and FORCE_COLOR environment
 * variables for accessible terminal output. Color semantics match the
 * shared formatter in @n-dx/llm-client/help-format.
 *
 * @module n-dx/help
 */

// ── ANSI color support ──────────────────────────────────────────────────

/**
 * Detect whether the terminal supports color output.
 * Mirrors the logic in @n-dx/llm-client/help-format.
 */
function supportsColor() {
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  if (process.stdout && typeof process.stdout.isTTY === "boolean") {
    return process.stdout.isTTY;
  }
  return false;
}

let _colorEnabled = null;

function isColorEnabled() {
  if (_colorEnabled === null) {
    _colorEnabled = supportsColor();
  }
  return _colorEnabled;
}

function ansi(code, text, reset) {
  if (!isColorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[${reset}m`;
}

function bold(text) { return ansi("1", text, "22"); }
function dim(text) { return ansi("2", text, "22"); }
function cyan(text) { return ansi("36", text, "39"); }
function yellow(text) { return ansi("33", text, "39"); }

/** Format a command name (cyan). */
function cmd(text) { return cyan(text); }
/** Format a flag/option name (yellow). */
function flag(text) { return yellow(text); }

/**
 * Format a flag string with color highlighting.
 * Highlights flag names in yellow.
 */
function formatFlag(flagStr) {
  return flagStr.replace(/--[\w-]+(?:=<[^>]+>)?|-\w/g, (match) => flag(match));
}

// ── Command registry ────────────────────────────────────────────────────

/**
 * @typedef {Object} CommandEntry
 * @property {string} name - Command name
 * @property {string} category - Category grouping (e.g. "Orchestration", "Tools")
 * @property {string} summary - One-line description
 * @property {string[]} keywords - Search keywords
 * @property {string[]} related - Names of related commands
 * @property {string} [parent] - Parent tool for subcommands (e.g. "rex")
 */

/** @type {CommandEntry[]} */
const COMMAND_REGISTRY = [
  // ── Orchestration commands ──
  {
    name: "init",
    category: "Orchestration",
    summary: "Initialize all tools (sourcevision + rex + hench)",
    keywords: ["setup", "create", "bootstrap", "initialize", "project", "start"],
    related: ["plan", "status"],
  },
  {
    name: "plan",
    category: "Orchestration",
    summary: "Analyze codebase and generate PRD proposals",
    keywords: ["analyze", "PRD", "proposals", "codebase", "scan", "guided", "import", "spec"],
    related: ["init", "work", "status"],
  },
  {
    name: "refresh",
    category: "Orchestration",
    summary: "Refresh SourceVision data and dashboard UI artifacts",
    keywords: ["refresh", "dashboard", "sourcevision", "analyze", "build", "pr-markdown"],
    related: ["plan", "start", "web"],
  },
  {
    name: "work",
    category: "Orchestration",
    summary: "Execute the next task autonomously with hench agent",
    keywords: ["run", "execute", "agent", "task", "autonomous", "hench", "loop", "epic"],
    related: ["plan", "status"],
  },
  {
    name: "status",
    category: "Orchestration",
    summary: "Show PRD status tree with completion stats",
    keywords: ["PRD", "tree", "progress", "completion", "stats", "overview"],
    related: ["plan", "usage", "work"],
  },
  {
    name: "usage",
    category: "Orchestration",
    summary: "Token usage analytics and cost estimation",
    keywords: ["tokens", "cost", "analytics", "LLM", "consumption", "billing"],
    related: ["status"],
  },
  {
    name: "sync",
    category: "Orchestration",
    summary: "Sync local PRD with remote adapter (e.g. Notion)",
    keywords: ["remote", "Notion", "push", "pull", "bidirectional", "adapter"],
    related: ["status"],
  },
  {
    name: "start",
    category: "Orchestration",
    summary: "Start dashboard and MCP server",
    keywords: ["server", "web", "dashboard", "MCP", "HTTP", "background", "daemon"],
    related: ["web", "dev"],
  },
  {
    name: "dev",
    category: "Orchestration",
    summary: "Start dev server with live reload",
    keywords: ["development", "HMR", "hot reload", "server"],
    related: ["start"],
  },
  {
    name: "web",
    category: "Orchestration",
    summary: "Alias for start (legacy)",
    keywords: ["server", "dashboard", "MCP"],
    related: ["start"],
  },
  {
    name: "ci",
    category: "Orchestration",
    summary: "Run analysis pipeline and validate PRD health",
    keywords: ["CI", "pipeline", "validation", "health", "continuous integration"],
    related: ["plan", "status"],
  },
  {
    name: "config",
    category: "Orchestration",
    summary: "View and edit settings across all packages",
    keywords: ["settings", "configuration", "preferences", "edit", "view", "feature", "toggle"],
    related: [],
  },
  // ── Tool delegation commands ──
  {
    name: "rex",
    category: "Tools",
    summary: "PRD management and task tracking",
    keywords: ["PRD", "tasks", "epics", "features", "management", "tracking"],
    related: ["hench", "sourcevision"],
  },
  {
    name: "hench",
    category: "Tools",
    summary: "Autonomous agent for task execution",
    keywords: ["agent", "autonomous", "execution", "Claude", "AI"],
    related: ["rex", "work"],
  },
  {
    name: "sourcevision",
    category: "Tools",
    summary: "Codebase analysis and visualization",
    keywords: ["analysis", "codebase", "static", "zones", "imports", "inventory"],
    related: ["rex", "plan"],
  },
  {
    name: "sv",
    category: "Tools",
    summary: "Alias for sourcevision",
    keywords: ["analysis", "codebase", "sourcevision"],
    related: ["sourcevision"],
  },
];

// ── Subcommand registries (for search across tool subcommands) ──────────

/** @type {Record<string, CommandEntry[]>} */
const SUBCOMMAND_REGISTRY = {
  rex: [
    { name: "init", parent: "rex", category: "Rex", summary: "Initialize .rex/ directory", keywords: ["setup", "create"], related: ["status", "analyze"] },
    { name: "status", parent: "rex", category: "Rex", summary: "Show PRD tree with completion stats", keywords: ["PRD", "tree", "progress"], related: ["next", "usage"] },
    { name: "next", parent: "rex", category: "Rex", summary: "Print next actionable task", keywords: ["task", "priority", "actionable"], related: ["status", "update"] },
    { name: "add", parent: "rex", category: "Rex", summary: "Add items to the PRD (manual or smart LLM mode)", keywords: ["create", "epic", "feature", "task", "subtask", "LLM", "smart"], related: ["analyze", "update"] },
    { name: "update", parent: "rex", category: "Rex", summary: "Update item status, priority, or title", keywords: ["modify", "change", "complete", "status"], related: ["add", "next"] },
    { name: "move", parent: "rex", category: "Rex", summary: "Reparent an item in the PRD tree", keywords: ["reparent", "hierarchy", "reorganize"], related: ["reshape"] },
    { name: "reshape", parent: "rex", category: "Rex", summary: "LLM-powered PRD restructuring", keywords: ["restructure", "merge", "split", "reorganize", "LLM"], related: ["prune", "move"] },
    { name: "prune", parent: "rex", category: "Rex", summary: "Remove completed subtrees", keywords: ["clean", "archive", "completed", "consolidate"], related: ["reshape", "status"] },
    { name: "validate", parent: "rex", category: "Rex", summary: "Check PRD integrity (DAG, schema)", keywords: ["check", "integrity", "schema", "DAG", "health"], related: ["fix", "report"] },
    { name: "fix", parent: "rex", category: "Rex", summary: "Auto-fix common PRD issues", keywords: ["repair", "timestamps", "references", "auto-fix"], related: ["validate"] },
    { name: "sync", parent: "rex", category: "Rex", summary: "Sync PRD with remote adapter", keywords: ["remote", "Notion", "push", "pull"], related: ["adapter"] },
    { name: "usage", parent: "rex", category: "Rex", summary: "Token usage analytics", keywords: ["tokens", "cost", "analytics"], related: ["status"] },
    { name: "report", parent: "rex", category: "Rex", summary: "Generate JSON health report", keywords: ["health", "CI", "JSON", "dashboard"], related: ["validate"] },
    { name: "verify", parent: "rex", category: "Rex", summary: "Run tests for acceptance criteria", keywords: ["test", "acceptance", "criteria", "coverage"], related: ["status"] },
    { name: "recommend", parent: "rex", category: "Rex", summary: "Get SourceVision-based recommendations", keywords: ["recommendations", "suggestions", "sourcevision"], related: ["analyze"] },
    { name: "analyze", parent: "rex", category: "Rex", summary: "Build PRD from project analysis", keywords: ["scan", "codebase", "proposals", "LLM", "import"], related: ["add", "recommend"] },
    { name: "adapter", parent: "rex", category: "Rex", summary: "Manage store adapters (list, add, remove, show)", keywords: ["Notion", "remote", "configure"], related: ["sync"] },
    { name: "mcp", parent: "rex", category: "Rex", summary: "Start MCP server for AI tool integration", keywords: ["MCP", "Claude", "AI", "tools"], related: [] },
  ],
  hench: [
    { name: "init", parent: "hench", category: "Hench", summary: "Create .hench/ with default configuration", keywords: ["setup", "create"], related: ["run", "config"] },
    { name: "run", parent: "hench", category: "Hench", summary: "Execute a task from the Rex PRD", keywords: ["execute", "task", "agent", "Claude", "autonomous", "loop"], related: ["status", "show"] },
    { name: "status", parent: "hench", category: "Hench", summary: "Show recent run history", keywords: ["history", "runs", "recent"], related: ["show", "run"] },
    { name: "show", parent: "hench", category: "Hench", summary: "Show full details of a specific run", keywords: ["details", "run", "tokens", "timing"], related: ["status"] },
    { name: "config", parent: "hench", category: "Hench", summary: "View or edit workflow configuration", keywords: ["settings", "model", "provider", "configuration"], related: ["template"] },
    { name: "template", parent: "hench", category: "Hench", summary: "Manage workflow templates", keywords: ["templates", "presets", "workflow", "save", "apply"], related: ["config"] },
  ],
  sourcevision: [
    { name: "init", parent: "sourcevision", category: "SourceVision", summary: "Set up .sourcevision/ directory", keywords: ["setup", "create"], related: ["analyze"] },
    { name: "analyze", parent: "sourcevision", category: "SourceVision", summary: "Run the analysis pipeline", keywords: ["inventory", "imports", "zones", "components", "scan"], related: ["validate", "serve"] },
    { name: "serve", parent: "sourcevision", category: "SourceVision", summary: "Start local viewer server", keywords: ["server", "viewer", "browse"], related: ["analyze"] },
    { name: "validate", parent: "sourcevision", category: "SourceVision", summary: "Validate analysis output files", keywords: ["check", "integrity", "CI"], related: ["analyze"] },
    { name: "reset", parent: "sourcevision", category: "SourceVision", summary: "Remove .sourcevision/ and start fresh", keywords: ["clean", "delete", "fresh"], related: ["init"] },
    { name: "export-pdf", parent: "sourcevision", category: "SourceVision", summary: "Export analysis as PDF report", keywords: ["PDF", "report", "export"], related: ["analyze"] },
    { name: "mcp", parent: "sourcevision", category: "SourceVision", summary: "Start MCP server for AI tool integration", keywords: ["MCP", "Claude", "AI", "tools"], related: [] },
  ],
};

// ── Levenshtein edit distance ──────────────────────────────────────────

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for typo correction — suggests commands within distance ≤ 2.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;

  // Optimize: short-circuit obvious cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row DP for memory efficiency
  const prev = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = prevDiag;
      } else {
        prev[j] = 1 + Math.min(prevDiag, prev[j - 1], prev[j]);
      }
      prevDiag = temp;
    }
  }

  return prev[n];
}

/**
 * Find the closest command names to the given input using edit distance.
 * Returns suggestions sorted by distance, filtered to distance ≤ maxDistance.
 *
 * @param {string} input - The mistyped command
 * @param {string[]} candidates - Valid command names
 * @param {number} [maxDistance=2] - Maximum edit distance to include
 * @returns {{ name: string, distance: number }[]}
 */
export function suggestCommands(input, candidates, maxDistance = 2) {
  const lower = input.toLowerCase();
  return candidates
    .map((name) => ({ name, distance: editDistance(lower, name.toLowerCase()) }))
    .filter((s) => s.distance > 0 && s.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Format a "Did you mean?" suggestion string for CLI output.
 *
 * @param {string} input - The mistyped command
 * @param {string[]} candidates - Valid command names
 * @param {string} [prefix=""] - Command prefix (e.g. "ndx ", "rex ")
 * @returns {string | null} - Formatted suggestion or null if no matches
 */
export function formatTypoSuggestion(input, candidates, prefix = "") {
  const suggestions = suggestCommands(input, candidates);
  if (suggestions.length === 0) return null;

  if (suggestions.length === 1) {
    return `Did you mean '${prefix}${suggestions[0].name}'?`;
  }

  const names = suggestions.slice(0, 3).map((s) => `${prefix}${s.name}`);
  return `Did you mean one of: ${names.join(", ")}?`;
}

// ── Search ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SearchResult
 * @property {string} name - Command name (e.g. "status" or "rex status")
 * @property {string} category - Category label
 * @property {string} summary - One-line description
 * @property {number} score - Relevance score (higher is better)
 * @property {string[]} matchReasons - What matched (e.g. "name", "keyword", "summary")
 */

/**
 * Search all help content for commands matching a keyword query.
 * Scores results by relevance: name match (10) > keyword match (5) > summary match (2).
 *
 * @param {string} query - Search query (case-insensitive)
 * @returns {SearchResult[]} - Results sorted by score descending
 */
export function searchHelp(query) {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  /** @type {SearchResult[]} */
  const results = [];

  /**
   * Score a command entry against the query.
   * @param {CommandEntry} entry
   * @param {string} displayName
   */
  function scoreEntry(entry, displayName) {
    let score = 0;
    const matchReasons = [];

    // Name match (exact or partial)
    if (entry.name.toLowerCase() === lower) {
      score += 15;
      matchReasons.push("exact name match");
    } else if (entry.name.toLowerCase().includes(lower)) {
      score += 10;
      matchReasons.push("name");
    }

    // Keyword matches
    for (const kw of entry.keywords) {
      const kwLower = kw.toLowerCase();
      for (const word of words) {
        if (kwLower === word) {
          score += 5;
          matchReasons.push(`keyword: ${kw}`);
        } else if (kwLower.includes(word) || word.includes(kwLower)) {
          score += 3;
          matchReasons.push(`keyword: ${kw}`);
        }
      }
    }

    // Summary match
    const summaryLower = entry.summary.toLowerCase();
    for (const word of words) {
      if (summaryLower.includes(word)) {
        score += 2;
        matchReasons.push("summary");
      }
    }

    // Category match
    if (entry.category.toLowerCase().includes(lower)) {
      score += 1;
      matchReasons.push("category");
    }

    if (score > 0) {
      results.push({
        name: displayName,
        category: entry.category,
        summary: entry.summary,
        score,
        matchReasons: [...new Set(matchReasons)],
      });
    }
  }

  // Score top-level commands
  for (const entry of COMMAND_REGISTRY) {
    scoreEntry(entry, entry.name);
  }

  // Score subcommands
  for (const [tool, subs] of Object.entries(SUBCOMMAND_REGISTRY)) {
    for (const entry of subs) {
      scoreEntry(entry, `${tool} ${entry.name}`);
    }
  }

  // Deduplicate: if a command appears as both top-level and subcommand, keep the higher score
  const deduped = new Map();
  for (const r of results) {
    const existing = deduped.get(r.name);
    if (!existing || r.score > existing.score) {
      deduped.set(r.name, r);
    }
  }

  return [...deduped.values()].sort((a, b) => b.score - a.score);
}

/**
 * Format search results for CLI output with color highlighting.
 *
 * @param {SearchResult[]} results
 * @param {string} query
 * @returns {string}
 */
export function formatSearchResults(results, query) {
  if (results.length === 0) {
    return `No commands found matching '${query}'.

Try '${cmd("ndx --help")}' to see all available commands.`;
  }

  const lines = [`Search results for '${query}':\n`];

  for (const r of results.slice(0, 10)) {
    lines.push(`  ${cmd("ndx " + r.name)}`);
    lines.push(`    ${dim(r.summary)}`);
  }

  if (results.length > 10) {
    lines.push(`\n  ${dim(`... and ${results.length - 10} more results`)}`);
  }

  lines.push(`\n${dim("Run 'ndx <command> --help' for detailed help on a specific command.")}`);

  return lines.join("\n");
}

// ── Related commands ──────────────────────────────────────────────────

/**
 * Get related command names for a given command.
 *
 * @param {string} command - Command name
 * @param {string} [tool] - Optional tool scope (e.g. "rex")
 * @returns {string[]}
 */
export function getRelatedCommands(command, tool) {
  if (tool && SUBCOMMAND_REGISTRY[tool]) {
    const entry = SUBCOMMAND_REGISTRY[tool].find((e) => e.name === command);
    if (entry) return entry.related;
  }

  const entry = COMMAND_REGISTRY.find((e) => e.name === command);
  return entry ? entry.related : [];
}

/**
 * Format a "See also" line for related commands.
 *
 * @param {string[]} related - Related command names
 * @param {string} [prefix="ndx"] - Command prefix
 * @returns {string | null}
 */
export function formatRelatedCommands(related, prefix = "ndx") {
  if (related.length === 0) return null;
  return `See also: ${related.map((r) => cmd(`${prefix} ${r}`)).join(dim(", "))}`;
}

// ── Navigation helpers ────────────────────────────────────────────────

/**
 * Get all valid command names for the orchestrator.
 * @returns {string[]}
 */
export function getOrchestratorCommands() {
  return COMMAND_REGISTRY.map((e) => e.name);
}

/**
 * Get all valid subcommand names for a tool.
 * @param {string} tool - Tool name (rex, hench, sourcevision)
 * @returns {string[]}
 */
export function getToolSubcommands(tool) {
  const registry = SUBCOMMAND_REGISTRY[tool] || SUBCOMMAND_REGISTRY[tool === "sv" ? "sourcevision" : tool];
  return registry ? registry.map((e) => e.name) : [];
}

/**
 * Format tool-specific help showing its subcommands with drill-down hints.
 * Uses consistent color coding: command names in cyan, summaries in default.
 *
 * @param {string} tool - Tool name
 * @returns {string | null}
 */
export function formatToolHelp(tool) {
  const normalizedTool = tool === "sv" ? "sourcevision" : tool;
  const subs = SUBCOMMAND_REGISTRY[normalizedTool];
  if (!subs) return null;

  const toolLabels = { rex: "Rex", hench: "Hench", sourcevision: "SourceVision" };
  const label = toolLabels[normalizedTool] || normalizedTool;

  const lines = [`${bold(label)} ${dim("—")} available commands:\n`];

  // Calculate padding for alignment
  const maxNameLen = Math.max(...subs.map((e) => e.name.length));
  const pad = Math.max(maxNameLen + 4, 18);

  for (const entry of subs) {
    const nameText = cmd(entry.name);
    const rawNameLen = entry.name.length;
    const spacing = " ".repeat(Math.max(pad - rawNameLen - 2, 2));
    lines.push(`  ${nameText}${spacing}${entry.summary}`);
  }

  lines.push(`\n${dim(`Run '${tool} <command> --help' for detailed help on a specific command.`)}`);

  return lines.join("\n");
}

// ── Orchestration command help definitions ────────────────────────────

/**
 * @typedef {Object} OrchestratorHelpDef
 * @property {string} summary - One-line description
 * @property {string} [description] - Multi-line description
 * @property {string|string[]} usage - Usage pattern(s)
 * @property {{title: string, content: string}[]} [sections] - Custom sections
 * @property {{flag: string, description: string}[]} [options] - Options
 * @property {{command: string, description: string}[]} [examples] - Examples
 * @property {string[]} [related] - Related commands
 */

/** @type {Record<string, OrchestratorHelpDef>} */
const ORCHESTRATOR_HELP_DEFS = {
  init: {
    summary: "initialize all tools",
    description: "Sets up .sourcevision/, .rex/, and .hench/ in the target directory.\nRuns sourcevision init → rex init → hench init in sequence.\nPrompts for an LLM vendor (claude or codex) unless --provider is given.\nAuto-configures Claude Code integration (MCP servers, skills, permissions) unless --no-claude.",
    usage: "ndx init [options] [dir]",
    options: [
      { flag: "--project=<name>", description: "Project name for config (default: directory basename)" },
      { flag: "--provider=<vendor>", description: "LLM vendor to configure: claude or codex (skips interactive prompt)" },
      { flag: "--analyze", description: "Also run SourceVision analysis after init" },
      { flag: "--no-claude", description: "Skip Claude Code integration (no .claude/ modifications)" },
    ],
    examples: [
      { command: "ndx init", description: "Initialize in current directory (prompts for vendor)" },
      { command: "ndx init --provider=claude .", description: "Initialize with Claude (skips vendor prompt)" },
      { command: "ndx init --provider=codex .", description: "Initialize with Codex (skips vendor prompt)" },
      { command: "ndx init --analyze .", description: "Initialize and analyze codebase" },
      { command: "ndx init --no-claude .", description: "Initialize without Claude Code integration" },
    ],
    related: ["plan", "status", "config"],
  },
  plan: {
    summary: "analyze codebase and generate PRD proposals",
    description: "Runs SourceVision analysis then Rex analyze to scan the codebase and\ngenerate PRD proposals. Proposals are reviewed interactively unless\n--accept is passed.",
    usage: "ndx plan [options] [dir]",
    options: [
      { flag: "--accept", description: "Accept all proposals without review" },
      { flag: "--guided", description: "Interactive spec builder for new projects" },
      { flag: "--file=<path>", description: "Import from a document (skip SourceVision scan)" },
      { flag: "--lite", description: "File-name-only scan (faster, less detail)" },
      { flag: "--no-llm", description: "Force algorithmic pipeline, skip LLM" },
      { flag: "--model=<name>", description: "Override LLM model" },
      { flag: "--chunk-size=<n>", description: "Proposals per page in interactive review" },
      { flag: "--quiet, -q", description: "Suppress informational output" },
    ],
    examples: [
      { command: "ndx plan", description: "Analyze and review proposals interactively" },
      { command: "ndx plan --accept .", description: "Auto-accept all proposals" },
      { command: "ndx plan --file=spec.md .", description: "Generate PRD from a spec document" },
      { command: "ndx plan --guided .", description: "Guided setup for a new project" },
    ],
    related: ["init", "work", "status"],
  },
  refresh: {
    summary: "refresh dashboard data and UI artifacts",
    description: "Runs SourceVision analysis and rebuilds dashboard UI artifacts.\nOptionally regenerates PR markdown.",
    usage: "ndx refresh [options] [dir]",
    options: [
      { flag: "--ui-only", description: "Rebuild UI artifacts only (skip data analysis)" },
      { flag: "--data-only", description: "Refresh SourceVision data only (skip UI build)" },
      { flag: "--pr-markdown", description: "Regenerate .sourcevision/pr-markdown.md only (skip analyze/build)" },
      { flag: "--no-build", description: "Skip UI build step after data refresh" },
      { flag: "--quiet, -q", description: "Suppress informational output from delegated tools" },
    ],
    examples: [
      { command: "ndx refresh", description: "Run full refresh (data + UI build)" },
      { command: "ndx refresh --data-only .", description: "Refresh SourceVision data only" },
      { command: "ndx refresh --ui-only .", description: "Rebuild UI only" },
      { command: "ndx refresh --pr-markdown .", description: "Run only PR markdown regeneration path" },
    ],
    related: ["plan", "start", "web"],
  },
  work: {
    summary: "execute the next task autonomously",
    description: "Picks the next actionable task from the PRD and runs an autonomous\nagent (hench) to implement it. Delegates to 'hench run'.\nRequires explicit vendor config: run 'ndx config llm.vendor claude'\nor 'ndx config llm.vendor codex' before using this command.",
    usage: "ndx work [options] [dir]",
    options: [
      { flag: "--task=<id>", description: "Target a specific Rex task ID" },
      { flag: "--epic=<id|title>", description: "Only consider tasks within the specified epic" },
      { flag: "--epic-by-epic", description: "Process epics sequentially" },
      { flag: "--auto", description: "Skip interactive selection, autoselect by priority" },
      { flag: "--iterations=<n>", description: "Run multiple tasks sequentially" },
      { flag: "--loop", description: "Run continuously until all tasks complete or Ctrl+C" },
      { flag: "--dry-run", description: "Print the task brief without calling Claude" },
      { flag: "--review", description: "Show proposed changes and prompt for approval" },
      { flag: "--max-turns=<n>", description: "Override max agent turns per task" },
      { flag: "--token-budget=<n>", description: "Cap total tokens per run (0 = unlimited)" },
      { flag: "--model=<model>", description: "Override the Claude model" },
    ],
    examples: [
      { command: "ndx work", description: "Run next task interactively" },
      { command: "ndx work --task=abc123 .", description: "Run a specific task" },
      { command: "ndx work --auto --loop .", description: "Continuously auto-run tasks" },
      { command: "ndx work --dry-run .", description: "Preview the brief without execution" },
    ],
    related: ["plan", "status"],
  },
  status: {
    summary: "show PRD status tree",
    description: "Displays the PRD hierarchy with status icons and completion stats.\nDelegates to 'rex status'. Completed items are hidden by default.",
    usage: "ndx status [options] [dir]",
    options: [
      { flag: "--all", description: "Show all items including completed" },
      { flag: "--coverage", description: "Show test coverage per task" },
      { flag: "--tokens=false", description: "Hide token usage summary" },
      { flag: "--since=<ISO>", description: "Filter token usage after timestamp" },
      { flag: "--until=<ISO>", description: "Filter token usage before timestamp" },
      { flag: "--format=tree|json", description: "Output format (default: tree)" },
    ],
    examples: [
      { command: "ndx status", description: "Show PRD tree" },
      { command: "ndx status --all", description: "Include completed items" },
      { command: "ndx status --format=json .", description: "JSON output for scripting" },
    ],
    related: ["plan", "usage", "work"],
  },
  usage: {
    summary: "token usage analytics",
    description: "Shows token consumption and cost estimates across all LLM operations.\nDelegates to 'rex usage'.",
    usage: "ndx usage [options] [dir]",
    options: [
      { flag: "--group=day|week|month", description: "Group usage by time period" },
      { flag: "--since=<ISO>", description: "Filter usage after timestamp" },
      { flag: "--until=<ISO>", description: "Filter usage before timestamp" },
      { flag: "--format=tree|json", description: "Output format (default: tree)" },
    ],
    examples: [
      { command: "ndx usage", description: "Show total token usage" },
      { command: "ndx usage --group=week", description: "Usage grouped by week" },
      { command: "ndx usage --format=json .", description: "Machine-readable output" },
    ],
    related: ["status"],
  },
  sync: {
    summary: "sync local PRD with remote adapter",
    description: "Bidirectional sync between local .rex/prd.json and a remote service.\nDelegates to 'rex sync'.",
    usage: "ndx sync [options] [dir]",
    options: [
      { flag: "--push", description: "Push local changes to remote only" },
      { flag: "--pull", description: "Pull remote changes to local only" },
      { flag: "--adapter=<name>", description: "Adapter name (default: notion)" },
      { flag: "--dry-run", description: "Preview sync without writing" },
    ],
    examples: [
      { command: "ndx sync", description: "Full bidirectional sync" },
      { command: "ndx sync --push .", description: "Push local changes to Notion" },
      { command: "ndx sync --pull .", description: "Pull remote changes down" },
    ],
    related: ["status"],
  },
  start: {
    summary: "start the dashboard and MCP server",
    description: "Starts the unified web server serving both the dashboard UI and\nMCP HTTP endpoints for Rex and SourceVision.",
    usage: "ndx start [subcommand] [options] [dir]",
    sections: [
      {
        title: "Subcommands",
        content: "(none)              Start the server (foreground)\nstop                Stop a background server\nstatus              Check if a background server is running",
      },
    ],
    options: [
      { flag: "--port=<N>", description: "Server port (default: 3117)" },
      { flag: "--background", description: "Run as a background daemon" },
    ],
    examples: [
      { command: "ndx start .", description: "Start server in foreground" },
      { command: "ndx start --background .", description: "Start as background daemon" },
      { command: "ndx start status .", description: "Check if server is running" },
      { command: "ndx start stop .", description: "Stop background server" },
    ],
    related: ["web", "dev"],
  },
  web: {
    summary: "alias for 'ndx start'",
    description: "Legacy alias for 'ndx start'. See 'ndx start --help' for full details.",
    usage: "ndx web [subcommand] [options] [dir]",
    examples: [
      { command: "ndx web .", description: "Start server" },
      { command: "ndx web --background .", description: "Start as background daemon" },
    ],
    related: ["start"],
  },
  ci: {
    summary: "run analysis pipeline and validate PRD health",
    description: "Runs the full CI pipeline: SourceVision analysis followed by PRD\nvalidation. Reports pass/fail status suitable for CI systems.",
    usage: "ndx ci [options] [dir]",
    options: [
      { flag: "--format=json", description: "Machine-readable JSON output" },
    ],
    examples: [
      { command: "ndx ci", description: "Run CI pipeline" },
      { command: "ndx ci --format=json .", description: "JSON output for CI integration" },
    ],
    related: ["plan", "status"],
  },
  dev: {
    summary: "start dev server with live reload",
    description: "Starts the development server with hot module replacement for the\nweb dashboard. Requires .sourcevision/ to exist.",
    usage: "ndx dev [options] [dir]",
    options: [
      { flag: "--port=<N>", description: "Server port (default: 3117)" },
      { flag: "--scope=<pkg>", description: "Limit to a specific package" },
    ],
    examples: [
      { command: "ndx dev .", description: "Start dev server" },
      { command: "ndx dev --port=8080 .", description: "Custom port" },
    ],
    related: ["start"],
  },
};

/**
 * Format help for an orchestration command using consistent styling.
 * Returns null if the command has no help definition.
 *
 * @param {string} command - Command name
 * @returns {string | null}
 */
export function formatOrchestratorCommandHelp(command) {
  const def = ORCHESTRATOR_HELP_DEFS[command];
  if (!def) return null;

  const lines = [];

  // ── Title ──
  lines.push(`${cmd("ndx")} ${cmd(command)} ${dim("—")} ${def.summary}`);
  lines.push("");

  // ── Description ──
  if (def.description) {
    lines.push(bold("DESCRIPTION"));
    for (const line of def.description.split("\n")) {
      lines.push(line ? `  ${line}` : "");
    }
    lines.push("");
  }

  // ── Usage ──
  const usageLines = Array.isArray(def.usage) ? def.usage : [def.usage];
  lines.push(bold("USAGE"));
  for (const u of usageLines) {
    lines.push(`  ${u}`);
  }
  lines.push("");

  // ── Custom sections ──
  if (def.sections) {
    for (const section of def.sections) {
      lines.push(bold(section.title.toUpperCase()));
      for (const line of section.content.split("\n")) {
        lines.push(line ? `  ${line}` : "");
      }
      lines.push("");
    }
  }

  // ── Options ──
  if (def.options && def.options.length > 0) {
    lines.push(bold("OPTIONS"));
    const maxFlagLen = Math.max(...def.options.map((o) => o.flag.length));
    const pad = Math.max(maxFlagLen + 4, 24);
    for (const opt of def.options) {
      const flagText = formatFlag(opt.flag);
      const rawFlagLen = opt.flag.length;
      const spacing = " ".repeat(Math.max(pad - rawFlagLen - 2, 2));
      lines.push(`  ${flagText}${spacing}${opt.description}`);
    }
    lines.push("");
  }

  // ── Examples ──
  if (def.examples && def.examples.length > 0) {
    lines.push(bold("EXAMPLES"));
    const maxCmdLen = Math.max(...def.examples.map((e) => e.command.length));
    const pad = Math.max(maxCmdLen + 4, 36);
    for (const ex of def.examples) {
      const cmdText = cmd(ex.command);
      const rawCmdLen = ex.command.length;
      const spacing = " ".repeat(Math.max(pad - rawCmdLen - 2, 2));
      lines.push(`  ${cmdText}${spacing}${dim(ex.description)}`);
    }
    lines.push("");
  }

  // ── See also ──
  if (def.related && def.related.length > 0) {
    const relatedStr = def.related.map((r) => cmd(`ndx ${r}`)).join(dim(", "));
    lines.push(dim("See also: ") + relatedStr);
  }

  return lines.join("\n");
}

/**
 * Format the main ndx help page with consistent visual styling.
 * @returns {string}
 */
export function formatMainHelp() {
  const lines = [];

  lines.push(`${bold("n-dx")} ${dim("—")} AI-powered development toolkit`);
  lines.push("");

  // ── Orchestration ──
  lines.push(bold("ORCHESTRATION"));
  const orchestrationItems = [
    ["init [dir]", "Initialize all tools (sourcevision + rex + hench)"],
    ["plan [dir]", "Analyze codebase and show PRD proposals (--guided for new projects)"],
    ["plan --accept [dir]", "Analyze and accept proposals into PRD"],
    ["refresh [dir]", "Refresh dashboard artifacts (--ui-only, --data-only, --pr-markdown, --no-build)"],
    ["work [dir]", "Run next task (--task=ID, --epic=ID, --epic-by-epic, --auto)"],
    ["status [dir]", "Show PRD status (--format=json, --since, --until)"],
    ["usage [dir]", "Token usage analytics (--format=json, --group=day|week|month)"],
    ["sync [dir]", "Sync local PRD with remote adapter (--push, --pull)"],
    ["start [dir]", "Start server: dashboard + MCP (--port=N, --background, stop, status)"],
    ["dev [dir]", "Start dev server with live reload (--port=N, --scope=<pkg>)"],
    ["web [dir]", "Alias for start (--port=N, --background, stop, status)"],
    ["ci [dir]", "Run analysis pipeline and validate PRD health"],
    ["config [key] [value]", "View and edit settings (--json, --help)"],
  ];
  const maxOrchLen = Math.max(...orchestrationItems.map(([n]) => n.length));
  const orchPad = Math.max(maxOrchLen + 4, 24);
  for (const [name, desc] of orchestrationItems) {
    const spacing = " ".repeat(Math.max(orchPad - name.length - 2, 2));
    lines.push(`  ${cmd(name)}${spacing}${desc}`);
  }
  lines.push("");

  // ── Tools ──
  lines.push(bold("TOOLS") + dim(" (via orchestrator or standalone)"));
  const toolItems = [
    ["rex ...", "PRD management and task tracking"],
    ["hench ...", "Autonomous agent for task execution"],
    ["sourcevision ...", "Codebase analysis and visualization"],
    ["sv ...", "Alias for sourcevision"],
  ];
  for (const [name, desc] of toolItems) {
    const spacing = " ".repeat(Math.max(orchPad - name.length - 2, 2));
    lines.push(`  ${cmd(name)}${spacing}${desc}`);
  }
  lines.push("");

  // ── Options ──
  lines.push(bold("OPTIONS"));
  lines.push(`  ${formatFlag("--quiet, -q")}           Suppress informational output (for scripting)`);
  lines.push("");

  // ── Usage ──
  lines.push(bold("USAGE"));
  lines.push(`  ${cmd("ndx")} ${dim("<command>")} ${dim("[args...]")}`);
  lines.push(`  ${cmd("n-dx")} ${dim("<command>")} ${dim("[args...]")}`);
  lines.push("");

  // ── Footer hints ──
  lines.push(dim("Run 'ndx <command> --help' for detailed help on any command."));
  lines.push(dim("Run 'ndx help <keyword>' to search all commands by keyword."));
  lines.push(dim("Standalone binaries (rex, hench, sourcevision, sv) are also available after install."));

  return lines.join("\n");
}
