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
  if (
    process.env.FORCE_COLOR !== undefined &&
    process.env.FORCE_COLOR !== "0"
  ) {
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

export function purple(text) {
  return ansi("35", text, "39");
}
export function green(text) {
  return ansi("32", text, "39");
}
export function red(text) {
  return ansi("31", text, "39");
}
export function bold(text) {
  return ansi("1", text, "22");
}
export function dim(text) {
  return ansi("2", text, "22");
}

const isTTY = () => !!(process.stdout && process.stdout.isTTY);

// ── Brand constants ────────────────────────────────────────────────────

export const BRAND_NAME = "En Dash DX";
export const TOOL_NAME = "n-dx";

// ── Mascot (shaded half-block pixel art) ───────────────────────────────

/**
 * Shaded T-Rex mascot using the half-block fg/bg color technique.
 * Each character cell = 2 vertical pixels. ▀ uses foreground for the top
 * pixel and background for the bottom, giving true-color shading.
 *
 * Palette: 0=transparent, 1=body (bright purple), 2=outline (dark purple), 3=eye (white)
 */

const DINO_BODY_PIXELS = `
000000000000000000000000
000000000022222000000000
000000002222222222220000
000000002223222222120000
000000022222222222220000
000000222212122222220000
000000221111111111100000
000000022111111111000000`;

const DINO_LEGS = [
  // Frame 0 — reference: packages/rex/Rex-F.png (canonical frame; both feet planted on ground — ▄ at tips)
  `
000000022221221222200000
000000222221112222200000
002222222222111222000000
002222222222111220000000
000222222111111220000000
000022222211111220000000
000002222221112220000000
000000022211122220000000
000000022220000222000000
000000002110000021100000`,
  // Frame 1 — reference: packages/rex/Rex.png (stride phase 2; right leg stepped one pixel forward — ▄ at tip)
  `
000000022221221222000000
000000222221112222200000
002222222221111222200000
002222222222111220000000
000222222122111220000000
000022222211111220000000
000002222221112220000000
000000022211122220000000
000000002222002220000000
000000000211000211000000`,
];

// True-color ANSI codes for the shaded palette
const FG = {
  1: "\x1b[38;2;180;80;255m",
  2: "\x1b[38;2;100;30;160m",
  3: "\x1b[38;2;255;255;255m",
};
const BG = { 1: "\x1b[48;2;180;80;255m", 2: "\x1b[48;2;100;30;160m" };
const RS = "\x1b[0m";

function halfBlock(top, bot) {
  if (!top && !bot) return " ";
  if (top === bot) return (FG[top] || "") + "█" + RS;
  if (!top) return (FG[bot] || "") + "▄" + RS;
  if (!bot) return (FG[top] || "") + "▀" + RS;
  return (FG[top] || "") + (BG[bot] || "") + "▀" + RS;
}

function pixelsToLines(pixelStr) {
  const g = pixelStr
    .trim()
    .split("\n")
    .map((r) => [...r].map(Number));
  const lines = [];
  for (let y = 0; y < g.length; y += 2) {
    let s = "";
    for (let x = 0; x < (g[0]?.length || 0); x++) {
      s += halfBlock(g[y]?.[x] || 0, g[y + 1]?.[x] || 0);
    }
    lines.push(s);
  }
  return lines;
}

// Pre-render body and leg frames at module load
export const BODY = pixelsToLines(DINO_BODY_PIXELS);
export const LEGS = DINO_LEGS.map((l) => pixelsToLines(l));

/** Monochrome fallback for non-TTY (no true-color). Uses simple purple ANSI. */
const QUADRANT_BODY = [
  "                        ",
  "          █████         ",
  "        ████████████    ",
  "        ███ ████████    ",
  "       █████████████    ",
  "      ████ █ ███████    ",
  "      ██          █     ",
  "       ██        █      ",
  "       ████ ██ ███      ",
  "      █████   █████     ",
  "  █████████    ████     ",
  "  ██████████   ██       ",
  "   ██████ ██   ██       ",
  "    ██████     ██       ",
  "     ██████   ███       ",
  "       ███   ████       ",
];
// Frame 0 — reference: packages/rex/Rex-F.png (both legs planted — █ █ double-support)
// Frame 1 — reference: packages/rex/Rex.png (left leg fully planted — █ solid; right leg in stride)
const QUADRANT_LEGS = [
  ["        ████  ███       "],
  ["       ████    ███      "],
];

/** Static mascot string for non-TTY / test use (monochrome quadrant fallback). */
export function getMascot() {
  return [...QUADRANT_BODY, ...QUADRANT_LEGS[0]]
    .map((l) => purple(l))
    .join("\n");
}

/**
 * All animation frames of the mascot (monochrome quadrant fallback).
 * Frame index corresponds to QUADRANT_LEGS index.
 */
export function getMascotFrames() {
  return QUADRANT_LEGS.map((legs) =>
    [...QUADRANT_BODY, ...legs].map((l) => purple(l)).join("\n"),
  );
}

export { QUADRANT_LEGS };

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
      if (!isTTY()) {
        console.log(`  ${dim("▸")} ${text}`);
        return this;
      }
      process.stdout.write(`  ${purple(SPINNER_FRAMES[0])} ${text}`);
      timer = setInterval(() => {
        frame = (frame + 1) % SPINNER_FRAMES.length;
        process.stdout.write(
          `\r\x1b[K  ${purple(SPINNER_FRAMES[frame])} ${text}`,
        );
      }, TICK_MS);
      return this;
    },
    success(msg, detail) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isTTY()) process.stdout.write("\r\x1b[K");
      const d = detail ? ` ${dim("(" + detail + ")")}` : "";
      console.log(`  ${green("✓")} ${msg}${d}`);
    },
    fail(msg) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isTTY()) process.stdout.write("\r\x1b[K");
      console.log(`  ${red("✗")} ${msg}`);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isTTY()) process.stdout.write("\r\x1b[K");
    },
  };
}

// ── Init phase messages ────────────────────────────────────────────────

export const INIT_PHASES = {
  sourcevision: {
    spinner: "Mapping your codebase...",
    success: "Codebase mapped",
  },
  rex: { spinner: "Setting up the task den...", success: "Task den ready" },
  hench: { spinner: "Waking the agent...", success: "Agent standing by" },
  claude: {
    spinner: "Teaching Claude new tricks...",
    success: "Skills installed",
  },
  assistants: {
    spinner: "Wiring up assistant surfaces...",
    success: "Assistant surfaces ready",
  },
};

// ── Static formatters (non-TTY fallback and tests) ─────────────────────

export function formatInitBanner() {
  const mascot = getMascot();
  return (
    mascot +
    "\n\n  " +
    bold(purple(BRAND_NAME)) +
    "\n  " +
    dim(TOOL_NAME + " init") +
    "\n"
  );
}

export function formatRecap(results) {
  return [
    "",
    `  ${green("◆")} ${bold("Project initialized!")}`,
    "",
    `  .sourcevision/  ${results.sourcevision}`,
    `  .rex/           ${results.rex}`,
    `  .hench/         ${results.hench}`,
    `  LLM provider    ${results.provider}`,
    `  Claude Code     ${results.claudeCode}`,
    "",
    `  ${dim("Next steps:")}`,
    `  ${dim("  " + TOOL_NAME + " start .          spin up the dashboard + MCP servers")}`,
    `  ${dim("  " + TOOL_NAME + ' add "feature"    add requirements to the PRD')}`,
    `  ${dim("  " + TOOL_NAME + " work .           pick up a task and start building")}`,
    "",
    `  ${dim("Or open claude or codex and try /ndx-status or /ndx-capture to get started")}`,
    "",
  ].join("\n");
}
