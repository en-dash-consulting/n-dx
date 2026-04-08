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
const BODY = [
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

const LEGS = [
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

// ── Animated init UI ───────────────────────────────────────────────────

const DINO_LINES = BODY.length + LEGS[0].length; // 11
const HEADING_LINE = 1; // blank line after dino for heading
const HEADER_HEIGHT = DINO_LINES + 1 + 1 + 1; // dino + blank + heading + blank
const WALK_SPEED = 4; // move every N ticks
const LEG_SPEED = 3; // change legs every N steps

/**
 * Animated init UI with a walking dino header.
 *
 * The dino walks back and forth in a fixed header region while phase
 * spinners run in the progress area below. The animation runs continuously
 * from banner display through all phases until the recap.
 */
export function createInitUI() {
  const tty = isTTY();
  const termWidth = (process.stdout.columns || 80);
  const maxDinoWidth = Math.max(...[...BODY, ...LEGS[0], ...LEGS[1]].map((l) => l.length));
  const walkRange = Math.max(0, Math.min(termWidth - maxDinoWidth - 2, 30));

  let dinoX = 0;
  let direction = 1;
  let legFrame = 0;
  let spinnerFrame = 0;
  let tickCount = 0;
  let stepCount = 0;
  let timer = null;
  let progressLines = 0; // lines printed below the header
  let currentPhaseText = "";
  let phaseActive = false;

  function dinoLines() {
    return [...BODY, ...LEGS[legFrame]];
  }

  function headingStr() {
    return bold(purple(BRAND_NAME)) + "  " + dim(TOOL_NAME + " init");
  }

  /** Redraw the entire header region using cursor save/restore. */
  function redrawHeader() {
    const lines = dinoLines();
    // Distance from cursor to top of header
    const upBy = HEADER_HEIGHT + progressLines + (phaseActive ? 1 : 0);

    process.stdout.write("\x1b7");                   // save cursor
    process.stdout.write(`\x1b[${upBy}A`);           // move to top of header

    for (let i = 0; i < lines.length; i++) {
      process.stdout.write("\r\x1b[2K");             // clear line
      process.stdout.write(" ".repeat(dinoX) + purple(lines[i]));
      process.stdout.write("\x1b[1B");               // down one
    }
    // Blank line after dino
    process.stdout.write("\r\x1b[2K");
    process.stdout.write("\x1b[1B");
    // Heading line (centered-ish, not moving with dino)
    process.stdout.write("\r\x1b[2K");
    process.stdout.write("  " + headingStr());
    process.stdout.write("\x1b[1B");
    // Blank line
    process.stdout.write("\r\x1b[2K");

    process.stdout.write("\x1b8");                   // restore cursor
  }

  function tick() {
    tickCount++;
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;

    // Walk the dino
    if (tickCount % WALK_SPEED === 0) {
      dinoX += direction;
      stepCount++;
      if (dinoX >= walkRange || dinoX <= 0) direction *= -1;
      if (stepCount % LEG_SPEED === 0) legFrame = (legFrame + 1) % LEGS.length;
    }

    redrawHeader();

    // Redraw spinner on current line
    if (phaseActive) {
      process.stdout.write(`\r\x1b[K  ${purple(SPINNER_FRAMES[spinnerFrame])} ${currentPhaseText}`);
    }
  }

  return {
    printBanner() {
      if (!tty) {
        // Static fallback
        console.log(getMascot());
        console.log("");
        console.log("  " + headingStr());
        console.log("");
        return;
      }

      // Print initial header
      const lines = dinoLines();
      for (const line of lines) {
        console.log(purple(line));
      }
      console.log(""); // blank after dino
      console.log("  " + headingStr());
      console.log(""); // blank before progress

      // Start animation
      timer = setInterval(tick, TICK_MS);
    },

    startPhase(phaseName) {
      const phase = INIT_PHASES[phaseName];
      if (!phase) return;
      currentPhaseText = phase.spinner;
      phaseActive = true;

      if (!tty) {
        console.log(`  ${dim("▸")} ${phase.spinner}`);
        progressLines++;
        phaseActive = false;
        return;
      }

      // Write initial spinner frame
      process.stdout.write(`  ${purple(SPINNER_FRAMES[spinnerFrame])} ${currentPhaseText}`);
    },

    endPhase(phaseName, detail) {
      const phase = INIT_PHASES[phaseName];
      if (!phase) return;
      phaseActive = false;
      if (tty) process.stdout.write("\r\x1b[K");
      const d = detail ? ` ${dim("(" + detail + ")")}` : "";
      console.log(`  ${green("✓")} ${phase.success}${d}`);
      progressLines++;
    },

    failPhase(phaseName) {
      phaseActive = false;
      if (tty) process.stdout.write("\r\x1b[K");
      console.log(`  ${red("✗")} ${phaseName} failed`);
      progressLines++;
    },

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

    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}

// ── Legacy formatters (for non-init use or tests) ──────────────────────

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
