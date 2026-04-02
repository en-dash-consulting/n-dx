import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument } from "../../src/schema/index.js";

export function writePRD(dir: string, doc: PRDDocument): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

export function writeConfig<T extends Record<string, unknown>>(dir: string, config: T): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}
