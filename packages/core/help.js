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
    keywords: ["setup", "create", "bootstrap", "initialize", "project", "start", "model", "provider", "llm"],
    related: ["plan", "status"],
  },
  {
    name: "analyze",
    category: "Orchestration",
    summary: "Run SourceVision codebase analysis",
    keywords: ["analyze", "codebase", "scan", "sourcevision", "zones", "imports", "inventory", "deep"],
    related: ["recommend", "plan", "init"],
  },
  {
    name: "recommend",
    category: "Orchestration",
    summary: "Show or accept SourceVision-based recommendations",
    keywords: ["recommend", "findings", "suggestions", "acknowledge", "accept", "sourcevision", "actionable"],
    related: ["analyze", "plan", "work"],
  },
  {
    name: "plan",
    category: "Orchestration",
    summary: "Analyze codebase and generate PRD proposals",
    keywords: ["analyze", "PRD", "proposals", "codebase", "scan", "guided", "import", "spec"],
    related: ["init", "add", "work", "status"],
  },
  {
    name: "add",
    category: "Orchestration",
    summary: "Add items to the PRD from descriptions or files",
    keywords: ["add", "create", "PRD", "epic", "feature", "task", "subtask", "import", "smart"],
    related: ["plan", "status", "work"],
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
  {
    name: "export",
    category: "Orchestration",
    summary: "Export static deployable dashboard",
    keywords: ["export", "static", "deploy", "dashboard", "GitHub Pages", "Netlify", "S3"],
    related: ["start", "status"],
  },
  {
    name: "self-heal",
    category: "Orchestration",
    summary: "Iterative codebase improvement loop",
    keywords: ["heal", "iterate", "loop", "improve", "analyze", "recommend", "accept", "agent", "autonomous"],
    related: ["plan", "work", "refresh"],
  },
  {
    name: "single-command",
    category: "Orchestration",
    summary: "Run agent on a freeform description (alias: sc)",
    keywords: ["freeform", "single", "shot", "description", "agent", "quick", "focused", "task", "sc"],
    related: ["work", "self-heal", "pair-programming"],
  },
  {
    name: "sc",
    category: "Orchestration",
    summary: "Alias for single-command",
    keywords: ["freeform", "single", "shot", "description", "agent", "quick"],
    related: ["single-command", "work"],
  },
  {
    name: "pair-programming",
    category: "Orchestration",
    summary: "Run agent then cross-vendor review (alias: bicker)",
    keywords: ["pair", "programming", "bicker", "review", "cross-vendor", "freeform", "agent", "test", "validate"],
    related: ["single-command", "work", "self-heal"],
  },
  {
    name: "bicker",
    category: "Orchestration",
    summary: "Alias for pair-programming",
    keywords: ["pair", "bicker", "review", "cross-vendor", "freeform"],
    related: ["pair-programming", "work"],
  },
  // ── Manage commands (delegated from rex) ──
  {
    name: "validate",
    category: "Manage",
    summary: "Check PRD integrity (DAG, schema, references)",
    keywords: ["check", "integrity", "schema", "DAG", "health", "PRD"],
    related: ["fix", "health", "report"],
  },
  {
    name: "fix",
    category: "Manage",
    summary: "Auto-fix common PRD issues",
    keywords: ["repair", "timestamps", "references", "auto-fix", "PRD"],
    related: ["validate", "health"],
  },
  {
    name: "health",
    category: "Manage",
    summary: "Show PRD health summary",
    keywords: ["health", "check", "PRD", "summary", "diagnostics"],
    related: ["validate", "report"],
  },
  {
    name: "report",
    category: "Manage",
    summary: "Generate JSON health report",
    keywords: ["health", "CI", "JSON", "dashboard", "report"],
    related: ["validate", "health"],
  },
  {
    name: "verify",
    category: "Manage",
    summary: "Run tests for acceptance criteria",
    keywords: ["test", "acceptance", "criteria", "coverage", "verify"],
    related: ["status", "validate"],
  },
  {
    name: "update",
    category: "Manage",
    summary: "Update item status, priority, or title",
    keywords: ["modify", "change", "complete", "status", "priority"],
    related: ["add", "remove", "move"],
  },
  {
    name: "remove",
    category: "Manage",
    summary: "Remove an item from the PRD",
    keywords: ["delete", "remove", "item", "epic", "feature", "task"],
    related: ["add", "update", "prune"],
  },
  {
    name: "move",
    category: "Manage",
    summary: "Reparent an item in the PRD tree",
    keywords: ["reparent", "hierarchy", "reorganize", "move"],
    related: ["reshape", "reorganize"],
  },
  {
    name: "reshape",
    category: "Manage",
    summary: "LLM-powered PRD restructuring",
    keywords: ["restructure", "merge", "split", "reorganize", "LLM"],
    related: ["prune", "move", "reorganize"],
  },
  {
    name: "reorganize",
    category: "Manage",
    summary: "Reorganize PRD structure",
    keywords: ["reorganize", "restructure", "hierarchy"],
    related: ["reshape", "move"],
  },
  {
    name: "prune",
    category: "Manage",
    summary: "Remove completed subtrees from PRD",
    keywords: ["clean", "archive", "completed", "consolidate"],
    related: ["reshape", "status", "remove"],
  },
  {
    name: "next",
    category: "Manage",
    summary: "Print next actionable task",
    keywords: ["task", "priority", "actionable", "next"],
    related: ["status", "work", "update"],
  },
  // ── Delegated sourcevision commands ──
  {
    name: "reset",
    category: "Manage",
    summary: "Remove .sourcevision/ and start fresh",
    keywords: ["clean", "delete", "fresh", "reset", "sourcevision"],
    related: ["init", "analyze"],
  },
  // ── Delegated hench commands ──
  {
    name: "show",
    category: "Manage",
    summary: "Show full details of a hench run",
    keywords: ["details", "run", "tokens", "timing", "hench"],
    related: ["work", "status"],
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
    description: "Sets up .sourcevision/, .rex/, and .hench/ in the target directory.\nRuns sourcevision init → rex init → hench init in sequence.\nPrompts for an LLM vendor (claude or codex) unless --provider is given.\nProvisions assistant surfaces for both Claude and Codex unless limited\nby --no-claude, --no-codex, --claude-only, --codex-only, or --assistants=.\n\nThe init summary reports each assistant surface separately, listing the\nspecific artifacts (instruction files, skills, permissions, MCP servers)\nthat were provisioned for the repo.",
    usage: "ndx init [options] [dir]",
    options: [
      { flag: "--project=<name>", description: "Project name for config (default: directory basename)" },
      { flag: "--provider=<vendor>", description: "LLM vendor to configure: claude or codex (skips interactive prompt)" },
      { flag: "--model=<id>", description: "Model ID to persist (used with --provider)" },
      { flag: "--claude-model=<id>", description: "Claude model ID (implies --provider=claude)" },
      { flag: "--codex-model=<id>", description: "Codex model ID (implies --provider=codex)" },
      { flag: "--analyze", description: "Also run SourceVision analysis after init" },
      { flag: "--no-claude", description: "Skip Claude Code integration (no CLAUDE.md, .claude/ modifications)" },
      { flag: "--no-codex", description: "Skip Codex integration (no AGENTS.md, .agents/, .codex/ modifications)" },
      { flag: "--claude-only", description: "Provision only Claude Code surfaces (equivalent to --no-codex)" },
      { flag: "--codex-only", description: "Provision only Codex surfaces (equivalent to --no-claude)" },
      { flag: "--assistants=<list>", description: "Comma-separated list of assistants to provision (e.g. --assistants=claude,codex)" },
    ],
    examples: [
      { command: "ndx init", description: "Initialize in current directory (prompts for vendor)" },
      { command: "ndx init --provider=claude .", description: "Initialize with Claude (skips vendor prompt)" },
      { command: "ndx init --provider=codex .", description: "Initialize with Codex (skips vendor prompt)" },
      { command: "ndx init --provider=claude --model=claude-sonnet-4-6 .", description: "Set vendor and model explicitly" },
      { command: "ndx init --claude-model=claude-sonnet-4-6 .", description: "Set Claude model (implies --provider=claude)" },
      { command: "ndx init --codex-model=gpt-5-codex .", description: "Set Codex model (implies --provider=codex)" },
      { command: "ndx init --claude-model=claude-sonnet-4-6 --codex-model=gpt-5-codex .", description: "Configure both vendors at once" },
      { command: "ndx init --analyze .", description: "Initialize and analyze codebase" },
      { command: "ndx init --claude-only .", description: "Initialize with Claude surfaces only" },
      { command: "ndx init --codex-only .", description: "Initialize with Codex surfaces only" },
      { command: "ndx init --no-codex .", description: "Initialize without Codex integration" },
      { command: "ndx init --assistants=claude .", description: "Initialize with only Claude surfaces" },
    ],
    related: ["plan", "status", "config"],
  },
  analyze: {
    summary: "run SourceVision codebase analysis",
    description: "Runs the SourceVision static analysis pipeline on the target directory.\nProduces zone maps, import graphs, component catalogs, and findings.\nOutput is written to .sourcevision/.",
    usage: "ndx analyze [options] [dir]",
    options: [
      { flag: "--deep", description: "Enable AI-enriched zone analysis (slower, richer findings)" },
      { flag: "--full", description: "Re-analyze all phases, ignoring cache" },
      { flag: "--lite", description: "File-name-only scan (faster, less detail)" },
      { flag: "--quiet, -q", description: "Suppress informational output" },
    ],
    examples: [
      { command: "ndx analyze", description: "Run analysis in current directory" },
      { command: "ndx analyze --deep .", description: "Deep analysis with AI enrichment" },
      { command: "ndx analyze --deep --full .", description: "Full deep re-analysis" },
    ],
    related: ["recommend", "plan", "init"],
  },
  recommend: {
    summary: "show or accept SourceVision-based recommendations",
    description: "Reads SourceVision findings and maps them to actionable PRD recommendations.\nFindings are grouped by zone and category into hierarchical tasks.\nUse --accept to add recommendations to the PRD, --acknowledge to dismiss findings.",
    usage: "ndx recommend [options] [dir]",
    options: [
      { flag: "--accept", description: "Accept all recommendations into the PRD" },
      { flag: "--accept=<sel>", description: "Accept specific recommendations (=1,3,5 or =all)" },
      { flag: "--actionable-only", description: "Filter to anti-patterns, suggestions, and move-file findings only" },
      { flag: "--acknowledge=<sel>", description: "Acknowledge specific findings (=all or =1,2,3)" },
      { flag: "--acknowledge-completed", description: "Acknowledge findings from completed PRD tasks" },
      { flag: "--show-all", description: "Include acknowledged findings in output" },
      { flag: "--format=json", description: "Machine-readable JSON output" },
      { flag: "--max-findings-per-task=<n>", description: "Findings per task (default: 10)" },
    ],
    examples: [
      { command: "ndx recommend", description: "Show current recommendations" },
      { command: "ndx recommend --accept .", description: "Accept all into PRD" },
      { command: "ndx recommend --actionable-only .", description: "Show only actionable findings" },
      { command: "ndx recommend --acknowledge=all .", description: "Acknowledge all findings" },
    ],
    related: ["analyze", "plan", "work"],
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
    related: ["init", "add", "work", "status"],
  },
  add: {
    summary: "add items to the PRD",
    description: "Add items to the PRD from freeform descriptions, files, or stdin.\nDelegates to 'rex add' — supports smart-add (LLM-powered),\nmanual level-based add, and file import.",
    usage: [
      "ndx add <level> [dir]",
      'ndx add "<description>" ["<desc2>"]',
      "ndx add --file=<path> [dir]",
      "echo \"desc\" | ndx add [dir]",
    ],
    options: [
      { flag: "--file=<path>", description: "Import ideas from a freeform text file (repeatable)" },
      { flag: "--model=<name>", description: "Override LLM model for smart-add" },
      { flag: "--quiet, -q", description: "Suppress informational output" },
    ],
    examples: [
      { command: 'ndx add "Add user authentication"', description: "Smart-add from description" },
      { command: "ndx add epic", description: "Manually add an epic" },
      { command: "ndx add --file=ideas.md .", description: "Import from a text file" },
      { command: 'echo "dark mode" | ndx add', description: "Pipe description via stdin" },
    ],
    related: ["plan", "status", "work"],
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
  export: {
    summary: "export static deployable dashboard",
    description: "Generates a self-contained static directory from the current\nSourceVision and Rex data. Deployable to GitHub Pages, Netlify, S3,\nor any static host. All read-only views work; mutation UI is hidden.",
    usage: "ndx export [options] [dir]",
    options: [
      { flag: "--out-dir=<path>", description: "Output directory (default: ./ndx-export)" },
      { flag: "--base-path=<path>", description: "Base URL path for deployment (default: /)" },
      { flag: "--deploy=github", description: "Push to n-dx-dashboard branch for GitHub Pages" },
    ],
    examples: [
      { command: "ndx export", description: "Export to ./ndx-export" },
      { command: "ndx export --out-dir=dist .", description: "Export to ./dist" },
      { command: "ndx export --base-path=/my-project/ .", description: "Export with subpath" },
      { command: "ndx export --deploy=github .", description: "Export and deploy to GitHub Pages" },
    ],
    related: ["start", "status"],
  },
  validate: {
    summary: "check PRD integrity",
    description: "Validates the PRD structure: checks DAG integrity, schema conformance,\nparent-child references, and ID uniqueness. Delegates to 'rex validate'.",
    usage: "ndx validate [options] [dir]",
    options: [
      { flag: "--format=json", description: "Machine-readable JSON output" },
    ],
    examples: [
      { command: "ndx validate", description: "Check PRD integrity" },
      { command: "ndx validate --format=json .", description: "JSON output for CI" },
    ],
    related: ["fix", "health", "report"],
  },
  fix: {
    summary: "auto-fix common PRD issues",
    description: "Automatically repairs common PRD problems: missing timestamps,\nbroken parent references, orphaned items. Delegates to 'rex fix'.",
    usage: "ndx fix [options] [dir]",
    options: [
      { flag: "--dry-run", description: "Preview fixes without applying" },
    ],
    examples: [
      { command: "ndx fix", description: "Fix PRD issues" },
      { command: "ndx fix --dry-run .", description: "Preview fixes" },
    ],
    related: ["validate", "health"],
  },
  health: {
    summary: "show PRD health summary",
    description: "Displays a summary of PRD health including validation results,\ncompletion stats, and potential issues. Delegates to 'rex health'.",
    usage: "ndx health [options] [dir]",
    options: [
      { flag: "--format=json", description: "Machine-readable JSON output" },
    ],
    examples: [
      { command: "ndx health", description: "Show health summary" },
      { command: "ndx health --format=json .", description: "JSON output" },
    ],
    related: ["validate", "report"],
  },
  report: {
    summary: "generate JSON health report",
    description: "Generates a comprehensive JSON health report for CI/CD integration\nor dashboard consumption. Delegates to 'rex report'.",
    usage: "ndx report [options] [dir]",
    options: [
      { flag: "--format=json", description: "Machine-readable JSON output" },
    ],
    examples: [
      { command: "ndx report", description: "Generate health report" },
      { command: "ndx report --format=json .", description: "JSON report for CI" },
    ],
    related: ["validate", "health"],
  },
  verify: {
    summary: "run tests for acceptance criteria",
    description: "Runs test suites associated with PRD task acceptance criteria.\nVerifies that completed tasks actually pass their defined tests.\nDelegates to 'rex verify'.",
    usage: "ndx verify [options] [dir]",
    examples: [
      { command: "ndx verify", description: "Run acceptance criteria tests" },
      { command: "ndx verify .", description: "Verify in target directory" },
    ],
    related: ["status", "validate"],
  },
  update: {
    summary: "update a PRD item",
    description: "Updates the status, priority, or title of a PRD item by ID.\nDelegates to 'rex update'.",
    usage: "ndx update <id> [options] [dir]",
    options: [
      { flag: "--status=<status>", description: "New status (pending, in-progress, done, blocked)" },
      { flag: "--priority=<priority>", description: "New priority (low, medium, high, critical)" },
      { flag: "--title=<title>", description: "New title" },
    ],
    examples: [
      { command: "ndx update abc123 --status=done", description: "Mark item as done" },
      { command: "ndx update abc123 --priority=high", description: "Change priority" },
    ],
    related: ["add", "remove", "move"],
  },
  remove: {
    summary: "remove a PRD item",
    description: "Removes an item (and its children) from the PRD.\nDelegates to 'rex remove'.",
    usage: ["ndx remove <id> [dir]", "ndx remove <level> <id> [dir]"],
    examples: [
      { command: "ndx remove abc123", description: "Remove item by ID" },
      { command: "ndx remove epic abc123", description: "Remove epic by ID" },
    ],
    related: ["add", "update", "prune"],
  },
  move: {
    summary: "reparent a PRD item",
    description: "Moves an item to a new parent in the PRD tree.\nDelegates to 'rex move'.",
    usage: "ndx move <id> --parent=<new-parent-id> [dir]",
    options: [
      { flag: "--parent=<id>", description: "New parent ID" },
    ],
    examples: [
      { command: "ndx move abc123 --parent=def456", description: "Move item under new parent" },
    ],
    related: ["reshape", "reorganize"],
  },
  reshape: {
    summary: "LLM-powered PRD restructuring",
    description: "Uses an LLM to analyze and restructure the PRD tree for better\norganization. Can merge duplicates, split oversized items, and\nrebalance the hierarchy. Delegates to 'rex reshape'.",
    usage: "ndx reshape [options] [dir]",
    examples: [
      { command: "ndx reshape", description: "Restructure PRD" },
      { command: "ndx reshape .", description: "Restructure PRD in target directory" },
    ],
    related: ["prune", "move", "reorganize"],
  },
  reorganize: {
    summary: "reorganize PRD structure",
    description: "Reorganizes the PRD structure for better grouping and hierarchy.\nDelegates to 'rex reorganize'.",
    usage: "ndx reorganize [options] [dir]",
    examples: [
      { command: "ndx reorganize", description: "Reorganize PRD" },
      { command: "ndx reorganize .", description: "Reorganize PRD in target directory" },
    ],
    related: ["reshape", "move"],
  },
  prune: {
    summary: "remove completed subtrees",
    description: "Removes completed epics, features, and tasks from the PRD tree.\nArchives pruned items to .rex/archive.json for recovery.\nDelegates to 'rex prune'.",
    usage: "ndx prune [options] [dir]",
    options: [
      { flag: "--dry-run", description: "Preview what would be pruned without applying" },
    ],
    examples: [
      { command: "ndx prune", description: "Prune completed items" },
      { command: "ndx prune --dry-run .", description: "Preview pruning" },
    ],
    related: ["reshape", "status", "remove"],
  },
  next: {
    summary: "print next actionable task",
    description: "Shows the next task that should be worked on, based on priority\nand dependency ordering. Delegates to 'rex next'.",
    usage: "ndx next [options] [dir]",
    options: [
      { flag: "--format=json", description: "Machine-readable JSON output" },
    ],
    examples: [
      { command: "ndx next", description: "Show next task" },
      { command: "ndx next --format=json .", description: "JSON output" },
    ],
    related: ["status", "work", "update"],
  },
  reset: {
    summary: "remove .sourcevision/ and start fresh",
    description: "Deletes the .sourcevision/ directory so analysis can start from\nscratch. Delegates to 'sourcevision reset'.",
    usage: "ndx reset [dir]",
    examples: [
      { command: "ndx reset", description: "Reset sourcevision data" },
      { command: "ndx reset .", description: "Reset in target directory" },
    ],
    related: ["init", "analyze"],
  },
  show: {
    summary: "show details of a hench run",
    description: "Displays full details of a specific hench agent run, including\ntiming, token usage, and conversation. Delegates to 'hench show'.",
    usage: "ndx show <run-id> [dir]",
    examples: [
      { command: "ndx show abc123", description: "Show run details" },
    ],
    related: ["work", "status"],
  },
  "single-command": {
    summary: "run agent on a freeform description",
    description:
      "One-shot agent invocation that accepts a freeform description and runs\n" +
      "the agent against it directly, without requiring a PRD task, TDD loop,\n" +
      "or epic scope. Intended for quick, focused work like resolving test\n" +
      "failures or applying small targeted changes.\n\n" +
      "Leverages existing project documents (CONTEXT.md, llms.txt, prd.json)\n" +
      "as prompt context and records the run to .hench/runs/ without mutating\n" +
      "PRD state.\n\n" +
      "Alias: sc",
    usage: [
      'ndx single-command "<description>" [options] [dir]',
      'ndx sc "<description>" [options] [dir]',
    ],
    options: [
      { flag: "--dry-run", description: "Print the brief without calling the agent" },
      { flag: "--max-turns=<n>", description: "Override max agent turns" },
      { flag: "--model=<model>", description: "Override the configured LLM model" },
      { flag: "--token-budget=<n>", description: "Cap total tokens (0 = unlimited)" },
    ],
    examples: [
      { command: 'ndx single-command "fix failing tests"', description: "Run agent on freeform description" },
      { command: 'ndx sc "fix failing tests"', description: "Same via alias" },
      { command: 'ndx single-command "remove unused exports" .', description: "Specify project directory" },
      { command: 'ndx single-command "fix failing tests" --dry-run', description: "Preview brief without execution" },
    ],
    related: ["work", "self-heal"],
  },
  sc: {
    summary: "alias for single-command",
    description: "Alias for 'ndx single-command'. See 'ndx single-command --help' for full details.",
    usage: 'ndx sc "<description>" [options] [dir]',
    examples: [
      { command: 'ndx sc "fix failing tests"', description: "Run agent on freeform description" },
      { command: 'ndx sc "fix failing tests" --dry-run', description: "Preview brief without execution" },
    ],
    related: ["single-command", "work"],
  },
  "pair-programming": {
    summary: "run agent then cross-vendor review",
    description:
      "Two-step execution: the primary vendor runs the agent on the freeform description;\n" +
      "the opposing vendor then acts as reviewer by running the project's configured test\n" +
      "command and reporting a pass/fail verdict.\n\n" +
      "Cross-vendor review direction:\n" +
      "  • active vendor = claude  →  codex reviews\n" +
      "  • active vendor = codex   →  claude reviews\n\n" +
      "The reviewer output is printed under a clearly labelled\n" +
      "'Reviewer (claude|codex)' section. If tests fail the overall\n" +
      "command exits non-zero and the full failure output is shown verbatim.\n\n" +
      "Fallback behaviour:\n" +
      "  • If the reviewer vendor's CLI binary is not installed or not on\n" +
      "    PATH, the review step is skipped with a warning — the command\n" +
      "    still exits 0 (primary work succeeded).\n" +
      "  • If no test command is configured in .rex/config.json (the `test`\n" +
      "    field), the review step is skipped with a warning.\n\n" +
      "Configure the test command:\n" +
      "  ndx config hench.test \"pnpm test\"\n\n" +
      "Configure the reviewer CLI path (if not on PATH):\n" +
      "  ndx config llm.claude.cli_path /path/to/claude\n" +
      "  ndx config llm.codex.cli_path  /path/to/codex\n\n" +
      "Alias: bicker",
    usage: [
      'ndx pair-programming "<description>" [options] [dir]',
      'ndx bicker "<description>" [options] [dir]',
    ],
    options: [
      { flag: "--dry-run", description: "Print the brief without calling the agent or running tests" },
      { flag: "--skip-review", description: "Skip the cross-vendor review step" },
      { flag: "--max-turns=<n>", description: "Override max agent turns" },
      { flag: "--model=<model>", description: "Override the configured LLM model" },
      { flag: "--token-budget=<n>", description: "Cap total tokens (0 = unlimited)" },
    ],
    examples: [
      { command: 'ndx pair-programming "fix failing tests"', description: "Run agent and cross-vendor review" },
      { command: 'ndx bicker "fix failing tests"', description: "Same via alias" },
      { command: 'ndx pair-programming "fix failing tests" --skip-review', description: "Skip review step" },
      { command: 'ndx pair-programming "remove unused exports" .', description: "Specify project directory" },
    ],
    related: ["single-command", "work", "self-heal"],
  },
  bicker: {
    summary: "alias for pair-programming",
    description: "Alias for 'ndx pair-programming'. See 'ndx pair-programming --help' for full details.",
    usage: 'ndx bicker "<description>" [options] [dir]',
    examples: [
      { command: 'ndx bicker "fix failing tests"', description: "Run agent and cross-vendor review" },
      { command: 'ndx bicker "fix failing tests" --skip-review', description: "Skip review step" },
    ],
    related: ["pair-programming", "work"],
  },
  "self-heal": {
    summary: "iterative codebase improvement loop",
    description:
      "Runs N iterations of the full improvement cycle:\n" +
      "  1. sourcevision analyze --deep --full  (deep static analysis)\n" +
      "  2. rex recommend                       (zone-scoped, ≤3 findings/task)\n" +
      "  3. rex recommend --accept              (accept into PRD)\n" +
      "  4. hench run --auto --loop --self-heal (execute with code-change focus)\n" +
      "  5. rex recommend --acknowledge-completed (prevent finding regeneration)\n\n" +
      "Tasks are scoped by zone and capped at 3 findings each for actionable\n" +
      "granularity. Self-heal mode instructs the agent to make source code\n" +
      "changes (not documentation) and rejects doc-only completions.\n" +
      "Completed findings are acknowledged to prevent regeneration.\n" +
      "The loop terminates early if no progress is made between iterations.",
    usage: "ndx self-heal [N] [dir]",
    examples: [
      { command: "ndx self-heal 3 .", description: "Run 3 improvement iterations" },
      { command: "ndx self-heal .", description: "Run 1 iteration (default)" },
      { command: "ndx self-heal 5", description: "Run 5 iterations in current directory" },
    ],
    related: ["plan", "work", "refresh"],
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
 * Format the main ndx help page with workflow-based grouping.
 * @returns {string}
 */
export function formatMainHelp() {
  const lines = [];

  lines.push(`${bold("n-dx")} ${dim("—")} AI-powered development toolkit`);
  lines.push("");

  /**
   * Render a section with a bold header and aligned command/description rows.
   * @param {string} title
   * @param {[string, string][]} items
   * @param {number} pad
   */
  function section(title, items, pad) {
    lines.push(bold(title));
    for (const [name, desc] of items) {
      const spacing = " ".repeat(Math.max(pad - name.length - 2, 2));
      lines.push(`  ${cmd(name)}${spacing}${desc}`);
    }
    lines.push("");
  }

  const pad = 28;

  section("SETUP", [
    ["init [dir]", "Initialize project"],
    ["config [key] [value]", "View or edit settings"],
  ], pad);

  section("ANALYZE", [
    ["analyze [dir]", "Run codebase analysis (--deep, --full, --lite)"],
    ["recommend [dir]", "Show or accept recommendations (--accept, --actionable-only)"],
  ], pad);

  section("PLAN", [
    ["plan [dir]", "Analyze and generate PRD proposals (--guided, --accept)"],
    ['add "<desc>" [dir]', "Add items from descriptions, files, or stdin"],
  ], pad);

  section("EXECUTE", [
    ["work [dir]", "Run next task autonomously (--task=ID, --auto, --loop)"],
    ['single-command "<desc>"', "One-shot agent run from freeform description (alias: sc)"],
    ['pair-programming "<desc>"', "Agent + cross-vendor review (alias: bicker)"],
    ["self-heal [N] [dir]", "Iterative improvement loop (analyze, recommend, execute)"],
  ], pad);

  section("MANAGE", [
    ["status [dir]", "Show PRD status tree (--format=json, --all)"],
    ["next [dir]", "Print next actionable task"],
    ["update <id>", "Update item status, priority, or title"],
    ["remove <id>", "Remove an item from the PRD"],
    ["move <id>", "Reparent an item (--parent=<id>)"],
    ["validate [dir]", "Check PRD integrity"],
    ["fix [dir]", "Auto-fix common PRD issues"],
    ["health [dir]", "Show PRD health summary"],
    ["report [dir]", "Generate JSON health report"],
    ["verify [dir]", "Run tests for acceptance criteria"],
    ["reshape [dir]", "LLM-powered PRD restructuring"],
    ["reorganize [dir]", "Reorganize PRD structure"],
    ["prune [dir]", "Remove completed subtrees"],
    ["show <run-id>", "Show details of a hench run"],
    ["reset [dir]", "Remove .sourcevision/ and start fresh"],
  ], pad);

  section("SERVE", [
    ["start [dir]", "Start dashboard + MCP server (--port=N, --background)"],
    ["dev [dir]", "Start dev server with live reload"],
    ["refresh [dir]", "Refresh dashboard artifacts (--ui-only, --data-only)"],
    ["export [dir]", "Export static deployable dashboard (--deploy=github)"],
  ], pad);

  section("TRACK", [
    ["usage [dir]", "Token usage analytics (--group=day|week|month)"],
    ["sync [dir]", "Sync local PRD with remote adapter (--push, --pull)"],
    ["ci [dir]", "Run analysis pipeline and validate PRD health"],
  ], pad);

  // ── Options ──
  lines.push(bold("OPTIONS"));
  lines.push(`  ${formatFlag("--quiet, -q")}           Suppress informational output`);
  lines.push(`  ${formatFlag("-v, --version")}        Print the installed n-dx version`);
  lines.push("");

  // ── Usage ──
  lines.push(bold("USAGE"));
  lines.push(`  ${cmd("ndx")} ${dim("<command>")} ${dim("[args...]")}`);
  lines.push(`  ${cmd("n-dx")} ${dim("<command>")} ${dim("[args...]")}`);
  lines.push("");

  // ── Footer ──
  lines.push(dim("Run 'ndx <command> --help' for detailed help on any command."));
  lines.push(dim("Run 'ndx help <keyword>' to search all commands by keyword."));
  lines.push(dim("Run 'ndx <tool> <command>' for direct tool access (rex, sourcevision, hench)."));

  return lines.join("\n");
}
