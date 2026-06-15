import { cyan, green, red, dim } from "./help-format.js";
import { isQuiet } from "./output.js";

const isTTY = () => !!(process.stdout && process.stdout.isTTY);

const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const TICK_MS = 80;

/**
 * Standalone animated spinner for CLI tools.
 */
export function createSpinner(text: string) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let frame = 0;

  return {
    start() {
      if (isQuiet()) return this;
      if (!isTTY()) {
        console.log(`  ${dim("▸")} ${text}`);
        return this;
      }
      process.stdout.write(`  ${cyan(SPINNER_FRAMES[0])} ${text}`);
      timer = setInterval(() => {
        frame = (frame + 1) % SPINNER_FRAMES.length;
        process.stdout.write(`\r\x1b[K  ${cyan(SPINNER_FRAMES[frame])} ${text}`);
      }, TICK_MS);
      return this;
    },
    success(msg: string, detail?: string) {
      if (isQuiet()) return;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isTTY()) process.stdout.write("\r\x1b[K");
      const d = detail ? ` ${dim("(" + detail + ")")}` : "";
      console.log(`  ${green("✓")} ${msg}${d}`);
    },
    fail(msg: string) {
      if (isQuiet()) return;
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
