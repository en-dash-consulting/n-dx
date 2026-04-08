/**
 * Brand assets and animated CLI UI for the n-dx toolkit.
 *
 * Single home for mascot art, phase messages, colors, and the reusable
 * spinner utility. Any command that needs progress indication or branded
 * output should import from here.
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

// ── Brand constants ────────────────────────────────────────────────────

export const BRAND_NAME = "En Dash DX";
export const TOOL_NAME = "n-dx";

// ── Mascot ─────────────────────────────────────────────────────────────

/**
 * Pixel-art raptor mascot using Unicode block characters (█ ▀ ▄ ▌ ▐ etc.)
 * for crisp rendering in monospace terminals. The eye (◕) is left uncolored
 * so it pops against the purple body.
 *
 * Each entry is either a single string (fully colored) or [before, eye, after]
 * segments so the eye character stays default color for contrast.
 */
const MASCOT_LINES = [
  ["           ▄████▄"],
  ["          ██ ", "◕", " ███▌"],
  ["          ███▄███▀"],
  ["           ▀███"],
  ["         ▄▄██▀"],
  ["    ▄▄ ▄█████╶╴"],
  ["    ████████████"],
  ["    ▀██████▀▀ █▌"],
  ["     █████████▀"],
  ["      ▀▀████▀"],
  ["        █▌▐█"],
  ["        ▀▘▝▀"],
];

/** Mascot art string, colored purple when color is supported. */
export function getMascot() {
  return MASCOT_LINES.map((segments) => {
    if (segments.length === 1) return purple(segments[0]);
    // Eye segment stays uncolored for contrast
    return purple(segments[0]) + segments[1] + purple(segments[2]);
  }).join("\n");
}

// ── Spinner / animated progress ────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

/**
 * Create an animated spinner for long-running operations.
 *
 * In a TTY, shows a braille animation that updates in-place.
 * In non-TTY (piped, CI), prints a static start line then a result line.
 *
 * Usage:
 *   const spinner = createSpinner("Analyzing codebase...");
 *   spinner.start();
 *   // ... do async work ...
 *   spinner.success("Analysis complete");
 *
 * @param {string} text - The message to show while spinning
 * @returns {{ start(): this, success(msg: string, detail?: string): void, fail(msg: string): void, stop(): void }}
 */
export function createSpinner(text) {
  const isTTY = !!(process.stdout && process.stdout.isTTY);
  let timer = null;
  let frameIndex = 0;

  function clearLine() {
    process.stdout.write("\r\x1b[K");
  }

  function render() {
    const frame = purple(SPINNER_FRAMES[frameIndex]);
    process.stdout.write(`\r\x1b[K  ${frame} ${text}`);
  }

  return {
    start() {
      if (!isTTY) {
        console.log(`  ${dim("▸")} ${text}`);
        return this;
      }
      render();
      timer = setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        render();
      }, SPINNER_INTERVAL_MS);
      return this;
    },

    success(msg, detail) {
      if (timer) { clearInterval(timer); timer = null; }
      if (isTTY) clearLine();
      const suffix = detail ? ` ${dim("(" + detail + ")")}` : "";
      console.log(`  ${green("✓")} ${msg}${suffix}`);
    },

    fail(msg) {
      if (timer) { clearInterval(timer); timer = null; }
      if (isTTY) clearLine();
      console.log(`  ${red("✗")} ${msg}`);
    },

    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (isTTY) clearLine();
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

// ── Formatted output builders ──────────────────────────────────────────

/**
 * Branded init banner: mascot + heading.
 * Contains "n-dx init" for backward-compatible test assertions.
 */
export function formatInitBanner() {
  const mascot = getMascot();
  const heading = [
    "",
    `  ${bold(purple(BRAND_NAME))}`,
    `  ${dim(TOOL_NAME + " init")}`,
    "",
  ].join("\n");
  return mascot + "\n" + heading;
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
