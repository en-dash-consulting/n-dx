/**
 * CLI output control — supports --quiet mode for scripting
 * and structured section headers for streaming agent output.
 *
 * Core primitives (setQuiet, isQuiet, info, result) are shared from
 * @n-dx/llm-client. Hench-specific extensions (section, subsection,
 * stream, detail) are defined here and use the shared isQuiet() state.
 *
 * This module is placed in types/ to avoid circular dependencies
 * between CLI and agent modules (both need output formatting).
 *
 * In quiet mode, only essential output is emitted:
 * - JSON output (--format=json)
 * - Error messages (always via console.error)
 * - Final result identifiers (e.g. run IDs, status)
 *
 * Informational messages (progress, hints, summaries) are suppressed.
 *
 * ## Rolling window (TTY mode)
 *
 * When stdout is a real TTY and color is enabled, stream() and detail()
 * render output through a rolling 10-line grey window that overwrites
 * previous lines in-place via ANSI cursor control. This keeps the terminal
 * clean during long agent runs.
 *
 * In non-TTY or NO_COLOR environments the rolling window is bypassed and
 * each line is printed directly via console.log(), matching prior behaviour.
 *
 * Full output (raw text, no ANSI) is always captured in _capturedLines for
 * log-file persistence by the sibling log-persistence subsystem.
 */

// Re-export shared foundation primitives.
export { setQuiet, isQuiet, info, result } from "../prd/llm-gateway.js";

import { isQuiet, bold, dim, yellow, colorDim, colorWarn, colorPink, isColorEnabled } from "../prd/llm-gateway.js";

// ---------------------------------------------------------------------------
// Rolling window state
// ---------------------------------------------------------------------------

const ROLLING_WINDOW_SIZE = 10;

/** Formatted (ANSI-coloured) lines currently visible in the rolling window. */
const _windowLines: string[] = [];

/** Number of lines we last rendered to the terminal via stdout.write. */
let _linesRendered = 0;

/** Full plain-text capture of every stream/detail line emitted this run. */
const _capturedLines: string[] = [];

/**
 * Override hook for tests — null means use process.stdout.isTTY.
 * @internal
 */
let _ttyOverride: boolean | null = null;

/**
 * Override TTY detection for unit tests. Pass null to restore runtime behaviour.
 * Also resets the window display state since the mode may have changed.
 * @internal
 */
export function _overrideTTY(value: boolean | null): void {
  _ttyOverride = value;
  resetRollingWindow();
}

/**
 * Whether rolling-window mode is active.
 * Requires a real TTY (cursor control needs one) AND colour support enabled
 * (NO_COLOR=1 implies non-interactive scripting — skip the window).
 */
function isRollingMode(): boolean {
  const isTTY = _ttyOverride !== null ? _ttyOverride : Boolean(process.stdout.isTTY);
  return isTTY && isColorEnabled();
}

/**
 * Truncate a formatted line so it fits within the terminal column width.
 * Long lines would wrap and break the cursor-up arithmetic.
 *
 * Counts visible characters (skipping ANSI escape codes) to find the exact
 * cut point, then appends \x1b[0m so no ANSI state leaks past the truncated
 * output into the next terminal line.
 */
function _truncateForTerminal(line: string): string {
  const cols = (process.stdout.columns ?? 120) - 2;
  const visible = line.replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length <= cols) return line;

  // Walk the raw string counting only visible characters so the cut point is
  // accurate even when the string contains many ANSI escape sequences.
  const ANSI_RE = /\x1b\[[0-9;]*m/g;
  let visibleCount = 0;
  let rawIndex = 0;

  while (rawIndex < line.length && visibleCount < cols - 1) {
    ANSI_RE.lastIndex = rawIndex;
    const match = ANSI_RE.exec(line);
    if (match && match.index === rawIndex) {
      rawIndex += match[0].length; // skip over ANSI escape (not visible)
    } else {
      visibleCount++;
      rawIndex++;
    }
  }

  // Always close any open ANSI sequences so no color state bleeds past this line.
  return line.slice(0, rawIndex) + "…\x1b[0m";
}

/**
 * Redraw all lines in the rolling window in-place.
 * Moves the cursor up by the number of previously rendered lines, then
 * clears and rewrites each line.
 */
function _redrawWindow(): void {
  if (_linesRendered > 0) {
    process.stdout.write(`\x1b[${_linesRendered}A`); // move cursor up N lines
  }
  for (const line of _windowLines) {
    // \x1b[0m before \n ensures ANSI state is fully reset after every line.
    // This prevents color from bleeding into the next window line or into any
    // output that follows the window frame (e.g. section() headers printed via
    // console.log). This is belt-and-suspenders for lines that already close
    // their own color codes, and the only safety net for lines that were split
    // from a multi-line colorDim-wrapped string whose reset code landed on the
    // last physical segment only.
    process.stdout.write(`\x1b[2K${_truncateForTerminal(line)}\x1b[0m\n`); // clear + write
  }
  _linesRendered = _windowLines.length;
}

/**
 * Append a new message to the rolling window buffer and redraw.
 *
 * Messages are split on embedded newlines so each physical terminal row is
 * a separate entry in _windowLines. A message with N newlines occupies N+1
 * visual rows and counts that way toward the ROLLING_WINDOW_SIZE cap.
 *
 * @param displayLine  ANSI-formatted text (may contain \n) for terminal display.
 * @param rawLine      Plain-text text (may contain \n) for log capture.
 */
function _pushWindowLine(displayLine: string, rawLine: string): void {
  const rawPhysical = rawLine.split("\n");
  const displayPhysical = displayLine.split("\n");
  for (let i = 0; i < rawPhysical.length; i++) {
    _capturedLines.push(rawPhysical[i] ?? "");
    if (_windowLines.length >= ROLLING_WINDOW_SIZE) {
      _windowLines.shift(); // evict the oldest visible row
    }
    _windowLines.push(displayPhysical[i] ?? "");
  }
  _redrawWindow();
}

/**
 * Reset the rolling window display state.
 * Call at the start of each run section (e.g. at each section() header) so
 * the new section begins with an empty window.
 * Does NOT reset the captured-lines buffer — that accumulates across sections.
 */
export function resetRollingWindow(): void {
  _windowLines.length = 0;
  _linesRendered = 0;
}

/**
 * Return all plain-text lines captured by stream() and detail() since the
 * last resetCapturedLines() call. Used by the log-persistence subsystem.
 */
export function getCapturedLines(): readonly string[] {
  return _capturedLines;
}

/**
 * Clear the captured lines buffer. Call after the run log has been written
 * to disk to release memory.
 */
export function resetCapturedLines(): void {
  _capturedLines.length = 0;
}

// ---------------------------------------------------------------------------
// Streaming output — section headers and labelled lines for agent runs
// ---------------------------------------------------------------------------

const SECTION_WIDTH = 60;

/**
 * Print a major section header. Suppressed in quiet mode.
 * Also resets the rolling window so each new section/task starts fresh.
 *
 *   ══════════════════════════════════════════════════════════════
 *   ❯ Section Title
 *   ══════════════════════════════════════════════════════════════
 */
export function section(title: string): void {
  if (isQuiet()) return;
  const rule = "═".repeat(SECTION_WIDTH);
  // Start each section with an empty rolling window so the new task's output
  // doesn't bleed into the previous task's last-10-line display.
  resetRollingWindow();
  console.log(`\n${colorPink(rule)}\n${bold(`❯ ${title}`)}\n${colorPink(rule)}`);
}

/**
 * Print a minor subsection header. Suppressed in quiet mode.
 *
 *   ── Subsection Title ──────────────────────────────────────────
 */
export function subsection(title: string): void {
  if (isQuiet()) return;
  const prefix = `── ${title} `;
  const pad = Math.max(0, SECTION_WIDTH - prefix.length);
  console.log(`\n${colorPink(bold(prefix))}${colorPink(dim("─".repeat(pad)))}`);
}

/**
 * Color mapping for source-attribution prefix labels in stream output.
 *
 * - Tool:   dim/grey  — secondary, operational tag
 * - Agent:  yellow    — primary agent voice
 * - Vendor/model names (Codex, claude, …): yellow — origin identifier
 *
 * Labels not listed here render without color.
 * Color helpers are evaluated at call time, so TTY and NO_COLOR detection
 * is honoured automatically via the shared llm-client isColorEnabled() logic.
 */
const STREAM_LABEL_COLORS: Readonly<Record<string, (text: string) => string>> = {
  Tool:   colorDim,
  Agent:  colorWarn,
  Codex:  yellow,
  claude: yellow,
};

/**
 * Color mapping for the message body (text portion) in stream output.
 *
 * - Agent: magenta — agent narrative text distinguishes itself from tool noise
 *
 * Labels not listed here receive no body color.
 * Raw text is always captured in _capturedLines without ANSI codes.
 */
const STREAM_TEXT_COLORS: Readonly<Record<string, (text: string) => string>> = {
  Agent: colorPink,
};

/**
 * Print a labelled streaming line. Suppressed in quiet mode.
 * The label is right-padded for alignment and color-coded by source type.
 *
 * In rolling-window mode (TTY + color enabled): the line is rendered in
 * grey/dim via colorDim and pushed into the 10-line in-place window.
 *
 * In non-TTY or NO_COLOR mode: the line is printed directly via console.log
 * preserving the existing label-color behaviour.
 *
 *   [Agent]   Some agent text…
 *   [Tool]    read_file({"path":"…"})
 *   [Result]  contents of file…
 */
export function stream(label: string, text: string): void {
  if (isQuiet()) return;
  const bracket = `[${label}]`;
  const colorFn = STREAM_LABEL_COLORS[label];
  const coloredBracket = colorFn ? colorFn(bracket) : bracket;
  const textColorFn = STREAM_TEXT_COLORS[label];
  // Apply text color per physical line so each line carries its own complete
  // open+close ANSI pair. Wrapping the whole multi-line string in a single
  // color call leaves the color code open across embedded newlines, causing
  // every subsequent line to inherit the color until the single closing code
  // is reached at the very end of the string.
  const coloredText = textColorFn
    ? text.split("\n").map(textColorFn).join("\n")
    : text;
  const padding = " ".repeat(Math.max(0, 10 - bracket.length));
  const rawLine = `  ${bracket}${padding} ${text}`;

  if (isRollingMode()) {
    // Agent lines keep their normal colors (yellow bracket, cyan body) so agent
    // voice remains readable during live streaming. Other labels are dimmed to
    // form the muted grey background band for tool noise.
    const displayLine =
      label === "Agent"
        ? `  ${coloredBracket}${padding} ${coloredText}`
        : colorDim(`  ${coloredBracket}${padding} ${coloredText}`);
    _pushWindowLine(displayLine, rawLine);
  } else {
    console.log(`  ${coloredBracket}${padding} ${coloredText}`);
    _capturedLines.push(rawLine);
  }
}

/**
 * Print a dim/secondary detail line. Suppressed in quiet mode.
 * Useful for metadata like timing, token counts, retry info.
 *
 * In rolling-window mode: pushed into the 10-line in-place window.
 * In non-TTY or NO_COLOR mode: printed directly via console.log.
 */
export function detail(text: string): void {
  if (isQuiet()) return;
  const indented = `           ${text}`;

  if (isRollingMode()) {
    _pushWindowLine(colorDim(indented), indented);
  } else {
    console.log(dim(indented));
    _capturedLines.push(indented);
  }
}
