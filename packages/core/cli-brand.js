/**
 * Brand assets for the n-dx CLI.
 *
 * Single home for mascot art, phase messages, colors, and formatted output.
 * Owns its own color detection to stay self-contained.
 *
 * @module n-dx/cli-brand
 */

// ── Color support ──────────────────────────────────────────────────────

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

/** Reset cached color state (for testing). */
export function resetColorCache() {
  _colorEnabled = null;
}

function ansi(code, text, reset) {
  if (!isColorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[${reset}m`;
}

export function purple(text) { return ansi("35", text, "39"); }
export function green(text) { return ansi("32", text, "39"); }
export function bold(text) { return ansi("1", text, "22"); }
export function dim(text) { return ansi("2", text, "22"); }

// ── Brand constants ────────��───────────────────────────────────────────

export const BRAND_NAME = "En Dash DX";
export const TOOL_NAME = "n-dx";

// ── Mascot ─────────────────────────────────────────────────────────────

const MASCOT_RAW = [
  "            __    ",
  "           / _)   ",
  "    .-^^^-/ /     ",
  "  _/       /      ",
  " /  (  |  (|      ",
  "(__.-|_|--|_|     ",
];

/** Mascot art lines, colored purple when color is supported. */
export function getMascot() {
  return MASCOT_RAW.map((line) => purple(line));
}

// ── Init phase messages ──────��─────────────────────────────────────────

export const INIT_PHASES = {
  sourcevision: { spinner: "Sniffing out your codebase...", success: "Codebase mapped" },
  rex:          { spinner: "Setting up the task den...",    success: "Task den ready" },
  hench:        { spinner: "Waking the agent...",           success: "Agent standing by" },
  claude:       { spinner: "Teaching Claude new tricks...", success: "Skills installed" },
};

// ── Formatted output builders ────��─────────────────────────────────────

/**
 * Branded init banner: mascot + heading.
 * Contains "n-dx init" for backward-compatible test assertions.
 */
export function formatInitBanner() {
  const mascotLines = getMascot();
  const heading = [
    "",
    `  ${bold(purple(BRAND_NAME))}`,
    `  ${dim(TOOL_NAME + " init")}`,
    "",
  ];
  return [...mascotLines, ...heading].join("\n");
}

/** Phase start line: "  ▸ Sniffing out your codebase..." */
export function formatPhaseStart(phaseName) {
  const phase = INIT_PHASES[phaseName];
  if (!phase) return "";
  return `  ${dim("▸")} ${phase.spinner}`;
}

/** Phase done line: "  ✓ Codebase mapped" (with optional detail). */
export function formatPhaseDone(phaseName, detail) {
  const phase = INIT_PHASES[phaseName];
  if (!phase) return "";
  const msg = detail ? `${phase.success} ${dim("(" + detail + ")")}` : phase.success;
  return `  ${green("✓")} ${msg}`;
}

/** Phase fail line: "  ✗ sourcevision failed" */
export function formatPhaseFail(phaseName) {
  return `  ${ansi("31", "✗", "39")} ${phaseName} failed`;
}

/**
 * Branded recap panel shown at end of init.
 *
 * @param {object} results
 * @param {string} results.sourcevision - "created" | "already exists (reused)"
 * @param {string} results.rex          - "created" | "already exists (reused)"
 * @param {string} results.hench        - "created" | "already exists (reused)"
 * @param {string} results.provider     - e.g. "claude (selected)"
 * @param {string} results.claudeCode   - e.g. "5 skills, 12 permissions"
 */
export function formatRecap(results) {
  const lines = [
    "",
    `  ${green("◆")} ${bold("Project initialized!")}`,
    "",
    `  .sourcevision/  ${results.sourcevision}`,
    `  .rex/           ${results.rex}`,
    `  .hench/         ${results.hench}`,
    `  LLM provider    ${results.provider}`,
    `  Claude Code     ${results.claudeCode}`,
    "",
    `  ${dim("Next: " + TOOL_NAME + " plan . — analyze your codebase")}`,
    "",
  ];
  return lines.join("\n");
}
