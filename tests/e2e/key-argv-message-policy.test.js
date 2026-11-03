/**
 * No message suggests a vendor key as a command-line value.
 *
 * A key typed as an argument lands in shell history and the process list. The
 * store prompts for it (`ndx config credentials.<vendor>`), so a message that
 * tells the user to run `config llm.<vendor>.api_key <KEY>` points them at the
 * leaky path. This scans source for that shape, so a new message cannot bring
 * it back.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES = ["llm-client", "hench", "rex", "core", "web"];
const SKIP_DIRS = new Set(["node_modules", "dist", "tests", "coverage", ".cache"]);
const SOURCE = /\.(?:ts|tsx|js|mjs)$/;

/** `config <anything>api_key|apiKey <value>`: a key given as an argument. */
const KEY_AS_ARGV = /\bconfig\s+[\w.]*(?:api_key|apiKey)\b[ \t]+(?!--)[^\s`'")]/;

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

describe("key-as-argv message policy", () => {
  it("matches the shapes it exists to catch", () => {
    for (const bad of [
      "ndx config llm.google.api_key <KEY>",
      "n-dx config claude.apiKey <key>",
      "n-dx config claude.api_key sk-ant-...",
      "'ndx config llm.codex.api_key $KEY'",
    ]) {
      expect(KEY_AS_ARGV.test(bad), bad).toBe(true);
    }
    for (const fine of [
      "ndx config credentials.claude",
      "ndx config llm.claude.api_key",
      "ndx config llm.claude.api_key --unset",
      "`ndx config claude.api_key`",
    ]) {
      expect(KEY_AS_ARGV.test(fine), fine).toBe(false);
    }
  });

  it("finds no message in llm-client, hench, rex, core or web that does", () => {
    const hits = [];
    for (const pkg of PACKAGES) {
      for (const file of sourceFiles(join(ROOT, "packages", pkg))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (KEY_AS_ARGV.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
