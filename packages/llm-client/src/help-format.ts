/**
 * Help formatting utilities with semantic color coding.
 *
 * Provides consistent, accessible help output across all n-dx CLI packages.
 * Colors respect NO_COLOR, FORCE_COLOR, and terminal capabilities.
 *
 * ## Color semantics
 *
 * ### Status / severity (use these for CLI output)
 *
 * | Helper         | Color  | Meaning                        |
 * |----------------|--------|--------------------------------|
 * | colorSuccess   | Green  | completed / success            |
 * | colorError     | Red    | failure / error                |
 * | colorPending   | Yellow | in-progress / pending          |
 * | colorWarn      | Yellow | warning                        |
 * | colorInfo      | Cyan   | informational / secondary hint |
 * | colorDim       | Dim    | muted / de-emphasised text     |
 *
 * ### Help formatting (use these for --help pages)
 *
 * | Element           | Color  | Purpose                          |
 * |-------------------|--------|----------------------------------|
 * | Commands          | Cyan   | Executable names and subcommands |
 * | Flags / options   | Yellow | --flag=<value> style options      |
 * | Section headers   | Bold   | DESCRIPTION, USAGE, OPTIONS, etc.|
 * | Required params   | Bold   | <required>                        |
 * | Optional params   | Dim    | [optional]                        |
 * | Descriptions      | (none) | Plain text for readability        |
 * | Dim / secondary   | Dim    | Hints, "See also", etc.          |
 *
 * @module @n-dx/llm-client/help-format
 */

// ── ANSI color support ──────────────────────────────────────────────────

/**
 * Detect whether the terminal supports color output.
 *
 * Respects the de-facto standards:
 * - NO_COLOR (https://no-color.org/) — disables color when set
 * - FORCE_COLOR — forces color when set (overrides NO_COLOR)
 * - CI environments typically have TERM=dumb or no TTY
 */
function supportsColor(): boolean {
  // FORCE_COLOR takes precedence over everything
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }

  // NO_COLOR disables color (https://no-color.org/)
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }

  // Check if stdout is a TTY
  if (process.stdout && typeof process.stdout.isTTY === "boolean") {
    return process.stdout.isTTY;
  }

  return false;
}

/** Cached color support result (computed once). */
let _colorEnabled: boolean | null = null;

/** Check if color is enabled (lazy, cached). */
export function isColorEnabled(): boolean {
  if (_colorEnabled === null) {
    _colorEnabled = supportsColor();
  }
  return _colorEnabled;
}

/** Reset cached color detection (for testing). */
export function resetColorCache(): void {
  _colorEnabled = null;
}

// ── ANSI escape helpers ─────────────────────────────────────────────────

/** Wrap text in an ANSI escape sequence, respecting color detection. */
function ansi(code: string, text: string, reset: string): string {
  if (!isColorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[${reset}m`;
}

/** Bold text (section headers, required params). */
export function bold(text: string): string {
  return ansi("1", text, "22");
}

/** Dim text (optional params, hints, secondary info). */
export function dim(text: string): string {
  return ansi("2", text, "22");
}

/** Cyan text (command names, executable names). */
export function cyan(text: string): string {
  return ansi("36", text, "39");
}

/** Yellow text (flags, options). */
export function yellow(text: string): string {
  return ansi("33", text, "39");
}

/** Green text (success, completed). */
export function green(text: string): string {
  return ansi("32", text, "39");
}

/** Red text (errors, failures). */
export function red(text: string): string {
  return ansi("31", text, "39");
}

// ── Status-semantic color helpers ───────────────────────────────────────

/**
 * Color helpers that express CLI output semantics rather than raw colors.
 * Prefer these over the raw `green`, `red`, etc. helpers when the intent
 * is to communicate status or severity.
 *
 * | Helper         | Meaning                        | Color  |
 * |----------------|--------------------------------|--------|
 * | colorSuccess   | completed / success            | green  |
 * | colorError     | failure / error                | red    |
 * | colorPending   | in-progress / pending          | yellow |
 * | colorWarn      | warning                        | yellow |
 * | colorInfo      | informational / secondary hint | cyan   |
 * | colorDim       | muted / de-emphasised text     | dim    |
 */

/** Color a success or completed status (green). */
export function colorSuccess(text: string): string {
  return green(text);
}

/** Color an error or failure status (red). */
export function colorError(text: string): string {
  return red(text);
}

/** Color a pending or in-progress status (yellow). */
export function colorPending(text: string): string {
  return yellow(text);
}

/** Color a warning (yellow). */
export function colorWarn(text: string): string {
  return yellow(text);
}

/** Color an informational or secondary hint (cyan). */
export function colorInfo(text: string): string {
  return cyan(text);
}

/** Mute or de-emphasise text (dim). */
export function colorDim(text: string): string {
  return dim(text);
}

// ── Semantic formatters ─────────────────────────────────────────────────

/** Format a command name (cyan). */
export function cmd(text: string): string {
  return cyan(text);
}

/** Format a flag/option name (yellow). */
export function flag(text: string): string {
  return yellow(text);
}

/** Format a section header (bold, uppercase). */
export function sectionHeader(text: string): string {
  return bold(text);
}

/** Format a required parameter (bold angle brackets). */
export function requiredParam(text: string): string {
  return bold(`<${text}>`);
}

/** Format an optional parameter (dim square brackets). */
export function optionalParam(text: string): string {
  return dim(`[${text}]`);
}

// ── Help formatter ──────────────────────────────────────────────────────

/**
 * Option definition for help formatting.
 */
export interface HelpOption {
  /** Flag name(s) including dashes, e.g. "--format=<value>" or "--quiet, -q" */
  flag: string;
  /** Description of the option */
  description: string;
  /** Whether this option is required (default: false) */
  required?: boolean;
}

/**
 * Example definition for help formatting.
 */
export interface HelpExample {
  /** The command to run */
  command: string;
  /** Description of what the command does */
  description: string;
}

/**
 * Complete help definition for a command.
 */
export interface HelpDefinition {
  /** Tool name (e.g. "rex", "hench", "ndx") */
  tool: string;
  /** Command name (e.g. "status", "run") */
  command: string;
  /** One-line summary after the em dash */
  summary: string;
  /** Multi-line description paragraph(s) */
  description?: string;
  /** Usage pattern(s) — each line is a separate usage form */
  usage: string | string[];
  /** Named sections (e.g. "Phases", "Subcommands", "Levels") — rendered as-is with header */
  sections?: Array<{ title: string; content: string }>;
  /** Options/flags */
  options?: HelpOption[];
  /** Examples */
  examples?: HelpExample[];
  /** Related commands (shown as "See also") */
  related?: string[];
}

/**
 * Format a flag string with color highlighting.
 * Highlights the flag name in yellow and value placeholders appropriately.
 */
function formatFlag(flagStr: string): string {
  // Handle compound flags like "--quiet, -q"
  return flagStr.replace(/--[\w-]+(?:=<[^>]+>)?|-\w/g, (match) => {
    return flag(match);
  });
}

/**
 * Format a complete help page from a definition.
 *
 * Produces consistently formatted output:
 * ```
 * tool command — summary
 *
 * DESCRIPTION
 *   Multi-line description text.
 *
 * USAGE
 *   tool command [options] [dir]
 *
 * OPTIONS
 *   --flag=<value>    Description
 *   --other           Description
 *
 * EXAMPLES
 *   tool command                  Description
 *   tool command --flag           Description
 *
 * See also: tool cmd1, tool cmd2
 * ```
 */
export function formatHelp(def: HelpDefinition): string {
  const lines: string[] = [];

  // ── Title line ──
  lines.push(`${cmd(def.tool)} ${cmd(def.command)} ${dim("—")} ${def.summary}`);
  lines.push("");

  // ── Description ──
  if (def.description) {
    lines.push(sectionHeader("DESCRIPTION"));
    for (const line of def.description.split("\n")) {
      lines.push(line ? `  ${line}` : "");
    }
    lines.push("");
  }

  // ── Usage ──
  const usageLines = Array.isArray(def.usage) ? def.usage : [def.usage];
  lines.push(sectionHeader("USAGE"));
  for (const u of usageLines) {
    lines.push(`  ${highlightUsageLine(u)}`);
  }
  lines.push("");

  // ── Custom sections (Phases, Subcommands, Levels, etc.) ──
  if (def.sections) {
    for (const section of def.sections) {
      lines.push(sectionHeader(section.title.toUpperCase()));
      for (const line of section.content.split("\n")) {
        lines.push(line ? `  ${line}` : "");
      }
      lines.push("");
    }
  }

  // ── Options ──
  if (def.options && def.options.length > 0) {
    lines.push(sectionHeader("OPTIONS"));

    // Calculate padding for alignment
    const maxFlagLen = Math.max(...def.options.map((o) => o.flag.length));
    const pad = Math.max(maxFlagLen + 4, 24); // At least 24 chars

    for (const opt of def.options) {
      const marker = opt.required ? bold("*") + " " : "  ";
      const flagText = formatFlag(opt.flag);
      // We need raw flag length for padding (without ANSI escapes)
      const rawFlagLen = opt.flag.length;
      const spacing = " ".repeat(Math.max(pad - rawFlagLen - 2, 2));
      lines.push(`${marker}${flagText}${spacing}${opt.description}`);
    }

    // Legend for required marker
    const hasRequired = def.options.some((o) => o.required);
    if (hasRequired) {
      lines.push("");
      lines.push(dim("  * = required"));
    }

    lines.push("");
  }

  // ── Examples ──
  if (def.examples && def.examples.length > 0) {
    lines.push(sectionHeader("EXAMPLES"));

    // Calculate padding for alignment
    const maxCmdLen = Math.max(...def.examples.map((e) => e.command.length));
    const pad = Math.max(maxCmdLen + 4, 36); // At least 36 chars

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
    const relatedStr = def.related.map((r) => cmd(`${def.tool} ${r}`)).join(dim(", "));
    lines.push(dim("See also: ") + relatedStr);
  }

  return lines.join("\n");
}

/**
 * Highlight a usage line: commands in cyan, [optional] in dim, <required> in bold.
 */
function highlightUsageLine(line: string): string {
  let result = line;

  // Highlight <required> params
  result = result.replace(/<([^>]+)>/g, (_, inner) => {
    return bold(`<${inner}>`);
  });

  // Highlight [optional] params
  result = result.replace(/\[([^\]]+)\]/g, (_, inner) => {
    return dim(`[${inner}]`);
  });

  // Highlight leading command (first 1-2 words that look like commands)
  // This handles "rex status" or "ndx plan" at the start
  result = result.replace(/^(\S+)(\s+)(\S+)/, (_, tool, space, command) => {
    // Only colorize if the first word looks like a tool name
    if (/^(ndx|n-dx|rex|hench|sourcevision|sv|echo|cat)$/.test(tool)) {
      return cmd(tool) + space + cmd(command);
    }
    return _;
  });

  return result;
}

/**
 * Format a top-level usage page (for the main help of a tool).
 *
 * Renders a structured overview with grouped commands and global options.
 */
export interface UsageSection {
  /** Section title (e.g. "Commands", "Orchestration", "Tools") */
  title: string;
  /** Items in this section */
  items: Array<{ name: string; description: string }>;
}

export interface UsageDefinition {
  /** Title line (e.g. "rex v0.1.0 — PRD management") */
  title: string;
  /** Usage pattern */
  usage: string;
  /** Grouped command sections */
  sections: UsageSection[];
  /** Global options */
  options?: HelpOption[];
  /** Footer lines (hints, tips) */
  footer?: string[];
}

/**
 * Format a top-level usage/help page.
 */
export function formatUsage(def: UsageDefinition): string {
  const lines: string[] = [];

  // ── Title ──
  lines.push(def.title);
  lines.push("");

  // ── Usage ──
  lines.push(sectionHeader("USAGE"));
  lines.push(`  ${highlightUsageLine(def.usage)}`);
  lines.push("");

  // ── Command sections ──
  for (const section of def.sections) {
    lines.push(sectionHeader(section.title.toUpperCase()));

    // Calculate padding for alignment
    const maxNameLen = Math.max(...section.items.map((i) => i.name.length));
    const pad = Math.max(maxNameLen + 4, 24);

    for (const item of section.items) {
      const nameText = cmd(item.name);
      const rawNameLen = item.name.length;
      const spacing = " ".repeat(Math.max(pad - rawNameLen - 2, 2));
      lines.push(`  ${nameText}${spacing}${item.description}`);
    }

    lines.push("");
  }

  // ── Global options ──
  if (def.options && def.options.length > 0) {
    lines.push(sectionHeader("OPTIONS"));

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

  // ── Footer ──
  if (def.footer) {
    for (const line of def.footer) {
      lines.push(dim(line));
    }
  }

  return lines.join("\n");
}
