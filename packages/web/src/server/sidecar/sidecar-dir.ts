import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Create the Sidecar directory with its own `.gitignore` (`*`): everything in it is machine-local. */
export function ensureSidecarDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n", "utf-8");
}
