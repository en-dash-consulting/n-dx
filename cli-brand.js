/**
 * Branded CLI output for n-dx.
 *
 * Provides a compact ASCII art header used by `ndx init` and other
 * commands that benefit from visual branding.
 *
 * @module n-dx/cli-brand
 */

const BRAND_COLOR = "\x1b[38;5;135m"; // medium purple
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Build the branded init banner as a string.
 * @param {boolean} useColor — whether to apply ANSI colors
 */
export function buildInitBanner(useColor = true) {
  if (!useColor) {
    return [
      "  ┌─────────────────┐",
      "  │    n · d x      │  AI-powered development toolkit",
      "  └─────────────────┘",
    ].join("\n");
  }
  return [
    `  ${DIM}┌─────────────────┐${RESET}`,
    `  ${DIM}│${RESET}    ${BRAND_COLOR}${BOLD}n · d x${RESET}      ${DIM}│${RESET}  AI-powered development toolkit`,
    `  ${DIM}└─────────────────┘${RESET}`,
  ].join("\n");
}

/**
 * Print the branded init banner to stdout.
 * Respects NO_COLOR env var and non-TTY.
 */
export function printInitBanner() {
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  console.log(buildInitBanner(useColor));
  console.log("");
}
