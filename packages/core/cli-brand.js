/**
 * Brand assets and animated CLI UI for the n-dx toolkit.
 *
 * Single home for mascot art, phase messages, colors, and reusable
 * animation utilities. Any command that needs progress indication or
 * branded output should import from here.
 *
 * ## Mascot design
 *
 * The raptor mascot is designed on a pixel grid and converted to Unicode
 * quadrant characters (▘▝▖▗▌▐▀▄█▙▛▜▟▚▞) for 2×2 sub-character resolution.
 * This gives crisp edges at any terminal font size.
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
export function red(text) { return ansi("31", text, "39"); }
export function bold(text) { return ansi("1", text, "22"); }
export function dim(text) { return ansi("2", text, "22"); }

const isTTY = () => !!(process.stdout && process.stdout.isTTY);

// ── Brand constants ────────────────────────────────────────────────────

export const BRAND_NAME = "En Dash DX";
export const TOOL_NAME = "n-dx";

// ── Mascot (pixel-grid quadrant art) ───────────────────────────────────

/**
 * Pre-rendered mascot lines from a 28×22 pixel grid converted to Unicode
 * quadrant block characters. 9 body lines + 2 leg-frame variants.
 */
export const BODY = [
  "       ▄▄▄▄",
  "      ▐▛▜██▙",
  "      ▐▙▟██▛",
  "      ▟██▛",
  "     ▟███▖",
  " ▚▖▗▟████▌",
  "  ▜██████▙▀",
  "   ▜█████▀▘",
  "    ▀▀▀▀",
];

export const LEGS = [
  ["    ▐▛▝█", "    █  ▐▌"],
  ["    █▘▝█", "   ▗▛  ▜▖"],
];

/** Static mascot string for non-TTY / test use. */
export function getMascot() {
  return [...BODY, ...LEGS[0]].map((l) => purple(l)).join("\n");
}

// ── Spinner ────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 80;

/**
 * Standalone animated spinner (for commands other than init).
 */
export function createSpinner(text) {
  let timer = null;
  let frame = 0;

  return {
    start() {
      if (!isTTY()) { console.log(`  ${dim("▸")} ${text}`); return this; }
      process.stdout.write(`  ${purple(SPINNER_FRAMES[0])} ${text}`);
      timer = setInterval(() => {
        frame = (frame + 1) % SPINNER_FRAMES.length;
        process.stdout.write(`\r\x1b[K  ${purple(SPINNER_FRAMES[frame])} ${text}`);
      }, TICK_MS);
      return this;
    },
    success(msg, detail) {
      if (timer) { clearInterval(timer); timer = null; }
      if (isTTY()) process.stdout.write("\r\x1b[K");
      const d = detail ? ` ${dim("(" + detail + ")")}` : "";
      console.log(`  ${green("✓")} ${msg}${d}`);
    },
    fail(msg) {
      if (timer) { clearInterval(timer); timer = null; }
      if (isTTY()) process.stdout.write("\r\x1b[K");
      console.log(`  ${red("✗")} ${msg}`);
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (isTTY()) process.stdout.write("\r\x1b[K");
    },
  };
}

// ── Init phase messages ────────────────────────────────────────────────

export const INIT_PHASES = {
  sourcevision: { spinner: "Sniffing out your codebase...", success: "Codebase mapped" },
  rex:          { spinner: "Setting up the task den...",    success: "Task den ready" },
  hench:        { spinner: "Waking the agent...",           success: "Agent standing by" },
  claude:       { spinner: "Teaching Claude new tricks...", success: "Skills installed" },
};

// ── Static formatters (non-TTY fallback and tests) ─────────────────────

export function formatInitBanner() {
  const mascot = getMascot();
  return mascot + "\n\n  " + bold(purple(BRAND_NAME)) + "\n  " + dim(TOOL_NAME + " init") + "\n";
}

export function formatRecap(results) {
  return [
    "", `  ${green("◆")} ${bold("Project initialized!")}`, "",
    `  .sourcevision/  ${results.sourcevision}`,
    `  .rex/           ${results.rex}`,
    `  .hench/         ${results.hench}`,
    `  LLM provider    ${results.provider}`,
    `  Claude Code     ${results.claudeCode}`,
    "", `  ${dim("Next: " + TOOL_NAME + " plan . — analyze your codebase")}`, "",
  ].join("\n");
}
