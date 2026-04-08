/**
 * Brand assets and animated CLI UI for the n-dx toolkit.
 *
 * Single home for mascot art, phase messages, colors, and reusable
 * animation utilities. Any command that needs progress indication or
 * branded output should import from here.
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

// ── Mascot ─────────────────────────────────────────────────────────────

/**
 * Compact pixel-art raptor (Chrome T-Rex inspired, not identical).
 * 5 body lines + 1 animated leg line = 6 total.
 *
 * The branded heading sits inline to the right of the dino at eye level,
 * keeping the entire banner under 7 lines.
 */
const BODY_LINES = [
  { body: "    ▄███▄" },
  { body: "   ██ ", eye: "◕", after: " █▌", heading: true },
  { body: "   ▀████▀▀▄" },
  { body: "  ▄████▀ ╶╴" },
  { body: "  ████████" },
  { body: "   ▀████▀" },
];

const LEG_FRAMES = [
  "    █▌▝▀",
  "   ▀▘ █▌",
];

function renderBodyLine(entry, headingText) {
  let line;
  if (entry.eye !== undefined) {
    line = purple(entry.body) + entry.eye + purple(entry.after);
  } else {
    line = purple(entry.body);
  }
  if (headingText && entry.heading) {
    line += "   " + headingText;
  }
  return line;
}

/** Static mascot string (no animation, for non-TTY or tests). */
export function getMascot() {
  const lines = BODY_LINES.map((entry) => renderBodyLine(entry));
  lines.push(purple(LEG_FRAMES[0]));
  return lines.join("\n");
}

// ── Spinner / animated progress ────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

/**
 * Create an animated spinner for standalone use (outside init).
 *
 * In a TTY, shows a braille animation that updates in-place.
 * In non-TTY (piped, CI), prints a static start line then a result line.
 *
 * @param {string} text - The message to show while spinning
 */
export function createSpinner(text) {
  let timer = null;
  let frameIndex = 0;

  return {
    start() {
      if (!isTTY()) {
        console.log(`  ${dim("▸")} ${text}`);
        return this;
      }
      const frame = purple(SPINNER_FRAMES[0]);
      process.stdout.write(`  ${frame} ${text}`);
      timer = setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        process.stdout.write(`\r\x1b[K  ${purple(SPINNER_FRAMES[frameIndex])} ${text}`);
      }, SPINNER_INTERVAL_MS);
      return this;
    },

    success(msg, detail) {
      if (timer) { clearInterval(timer); timer = null; }
      if (isTTY()) process.stdout.write("\r\x1b[K");
      const suffix = detail ? ` ${dim("(" + detail + ")")}` : "";
      console.log(`  ${green("✓")} ${msg}${suffix}`);
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

// ── Animated init UI ───────────────────────────────────────────────────

/**
 * Create an animated init UI with walking dino mascot.
 *
 * In a TTY: the dino's legs alternate while phases run with braille spinners.
 * In non-TTY: static mascot, static phase lines (▸ start / ✓ done).
 *
 * Usage:
 *   const ui = createInitUI();
 *   ui.printBanner();
 *   ui.startPhase("sourcevision");
 *   await doWork();
 *   ui.endPhase("sourcevision");
 *   ui.printRecap(results);
 */
export function createInitUI() {
  const tty = isTTY();
  let timer = null;
  let legFrame = 0;
  let spinnerFrame = 0;
  let linesAfterBanner = 0;
  let currentPhaseText = "";

  // After printing the banner, the leg line is HEADING_LINES lines
  // above the cursor. Each completed phase adds 1 line.
  const HEADING_LINES = 1; // single blank line after mascot

  function getLegOffset() {
    return HEADING_LINES + linesAfterBanner + 1; // +1 for current spinner line
  }

  function animateTick() {
    legFrame = (legFrame + 1) % LEG_FRAMES.length;
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;

    // Redraw dino legs
    const offset = getLegOffset();
    process.stdout.write("\x1b7");                                       // save cursor
    process.stdout.write(`\x1b[${offset}A`);                            // move up to leg line
    process.stdout.write(`\r\x1b[2K${purple(LEG_FRAMES[legFrame])}`);   // redraw legs
    process.stdout.write("\x1b8");                                       // restore cursor

    // Redraw spinner
    const frame = purple(SPINNER_FRAMES[spinnerFrame]);
    process.stdout.write(`\r\x1b[K  ${frame} ${currentPhaseText}`);
  }

  return {
    /**
     * Print the mascot banner with inline heading.
     * Contains "En Dash DX" and "n-dx init" for branding + test assertions.
     */
    printBanner() {
      const heading = bold(purple(BRAND_NAME)) + "  " + dim(TOOL_NAME + " init");
      const lines = BODY_LINES.map((entry) => renderBodyLine(entry, entry.heading ? heading : null));
      lines.push(purple(LEG_FRAMES[0]));
      console.log(lines.join("\n"));
      console.log(""); // blank line after mascot
      linesAfterBanner = 0;
    },

    /** Start an animated phase spinner (dino walks while spinner runs). */
    startPhase(phaseName) {
      const phase = INIT_PHASES[phaseName];
      if (!phase) return;
      currentPhaseText = phase.spinner;

      if (!tty) {
        console.log(`  ${dim("▸")} ${phase.spinner}`);
        linesAfterBanner++;
        return;
      }

      spinnerFrame = 0;
      const frame = purple(SPINNER_FRAMES[0]);
      process.stdout.write(`  ${frame} ${currentPhaseText}`);
      timer = setInterval(animateTick, SPINNER_INTERVAL_MS);
    },

    /** Complete the current phase with a success message. */
    endPhase(phaseName, detail) {
      const phase = INIT_PHASES[phaseName];
      if (!phase) return;
      if (timer) { clearInterval(timer); timer = null; }
      if (tty) process.stdout.write("\r\x1b[K");
      const suffix = detail ? ` ${dim("(" + detail + ")")}` : "";
      console.log(`  ${green("✓")} ${phase.success}${suffix}`);
      linesAfterBanner++;
    },

    /** Mark the current phase as failed. */
    failPhase(phaseName) {
      if (timer) { clearInterval(timer); timer = null; }
      if (tty) process.stdout.write("\r\x1b[K");
      console.log(`  ${red("✗")} ${phaseName} failed`);
      linesAfterBanner++;
    },

    /** Print the final recap panel. */
    printRecap(results) {
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
      console.log(lines.join("\n"));
    },

    /** Stop all animation (cleanup). */
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}

// ── Legacy formatters (for non-init commands or tests) ─────────────────

/** Branded init banner (static, for non-interactive / test use). */
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

/** Branded recap (static, for non-interactive / test use). */
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
