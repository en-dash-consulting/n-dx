/**
 * Gemini integration — provisions instruction files when `ndx init` is run.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import {
  writeVendorSkills,
  renderGeminiMd,
} from "./assistant-assets.js";

/**
 * Write all skill files for Gemini.
 */
function writeSkills(dir) {
  return writeVendorSkills("gemini", dir);
}

/**
 * Write `GEMINI.md` to the project root.
 */
function writeGeminiMd(dir) {
  const geminiPath = join(dir, "GEMINI.md");
  const content = renderGeminiMd();
  writeFileSync(geminiPath, content);
  return { written: true, path: geminiPath };
}

/**
 * Run the full Gemini integration setup.
 *
 * @param {string} dir  Project root directory
 * @returns {{ skills: object, instructions: object }}
 */
export function setupGeminiIntegration(dir) {
  const absDir = resolve(dir);

  const skills = writeSkills(absDir);
  const instructions = writeGeminiMd(absDir);

  return { skills, instructions };
}
