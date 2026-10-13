/**
 * Scan every production child-process spawn in the monorepo for the
 * `windowsHide` option.
 *
 * Used by `tests/e2e/windows-hide-policy.test.js` (the gate) and runnable on
 * its own to list what the gate would flag:
 *
 *   node scripts/lib/windows-hide-scan.mjs
 *
 * Why the flag matters on every hop is explained in the test's header; in
 * one line: a parent without a console (hub, background dashboard, narrate,
 * or anything spawned hidden) gives each unhidden console child its own
 * visible window.
 *
 * The scan is textual on purpose: a call's option object is the text from
 * the spawn call's opening parenthesis to its matching close. A call that
 * must inherit the operator's terminal passes `windowsHide:
 * !process.stdout.isTTY` and so still mentions the key; a call with a reason
 * to be exempt carries `windows-console: inherit` in a comment on the call or
 * the line above it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `spawn(`, `spawnSync(`, `execFile(`, `execFileSync(` — the node:child_process entry points n-dx uses. */
const SPAWN_CALL = /\b(spawn|spawnSync|execFile|execFileSync)\(/g;
/** The file imports from node:child_process, so a bare `spawn(` is the real one. */
const CHILD_PROCESS_IMPORT = /from\s+["']node:child_process["']|require\(\s*["']node:child_process["']\s*\)/;
const EXEMPT_MARKER = /windows-console:\s*inherit/;

/** Helpers whose options objects are built out of line and spread into the spawn. */
export const INDIRECT_OPTION_SOURCES = [
  // `exec()` spreads treeKillSpawnOptions() and sets windowsHide beside it.
  "packages/llm-client/src/exec.ts",
];

/** Directories that hold no production code: tests, developer tooling, build output. */
const SKIP_DIRS = new Set(["node_modules", "dist", "tests", "scripts", "dev"]);
/** Package-local developer entry points, run from a terminal by a developer, never by n-dx. */
const SKIP_FILES = /^(?:dev|build)\.(?:js|mjs)$/;

function walkSources(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, files);
    else if (/\.(?:ts|js|mjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) && !SKIP_FILES.test(entry.name)) files.push(full);
  }
  return files;
}

function collectScanRoots() {
  const roots = [];
  const packagesDir = join(ROOT, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(join(packagesDir, entry.name));
  }
  return roots;
}

function toPosixRelative(file) {
  return relative(ROOT, file).split(sep).join("/");
}

/** The text of a call from its opening parenthesis to the matching close. */
function callText(source, openParenIndex) {
  let depth = 0;
  let inString = null;
  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") inString = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openParenIndex, i + 1);
    }
  }
  return source.slice(openParenIndex);
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/** Whether any `...NAME` spread in the call resolves to a same-file `const NAME = {…}` matching `re`. */
function spreadConstantsMention(source, callText, re) {
  for (const spread of callText.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) {
    const def = new RegExp(`(?:const|let|var)\\s+${spread[1]}\\s*(?::[^=]+)?=\\s*\\{`).exec(source);
    if (!def) continue;
    const open = source.indexOf("{", def.index + def[0].length - 1);
    const body = callText.length ? source.slice(open, source.indexOf("}", open) + 1) : "";
    if (re.test(body)) return true;
  }
  return false;
}

/** Every production spawn whose options do not mention windowsHide and carry no exemption. */
export function findUnhiddenSpawns() {
  const flagged = [];
  for (const root of collectScanRoots()) {
    for (const file of walkSources(root)) {
      const rel = toPosixRelative(file);
      const source = readFileSync(file, "utf-8");
      if (!CHILD_PROCESS_IMPORT.test(source)) continue;
      const lines = source.split("\n");
      for (const match of source.matchAll(SPAWN_CALL)) {
        // `.exec(` on a RegExp and member calls like `cp.spawn(` are not the bare import.
        const before = source[match.index - 1] ?? "";
        if (before === "." || before === "`" || /\w/.test(before)) continue;
        // A method *definition* (`  spawn(cmd, args) {`) sits at the start of its line,
        // and a mention inside a comment (` * wraps a spawn(...)`) sits after `*` or `//`.
        const lineStart = source.lastIndexOf("\n", match.index) + 1;
        const lead = source.slice(lineStart, match.index).trim();
        if (lead === "" || lead.startsWith("*") || lead.startsWith("//")) continue;
        const text = callText(source, match.index + match[0].length - 1);
        if (/\bwindowsHide\b/.test(text)) continue;
        // Options spread from a constant in the same file (`{ cwd, ...QUIET_GIT }`):
        // the flag may live in that constant.
        if (spreadConstantsMention(source, text, /\bwindowsHide\b/)) continue;
        const line = lineOf(source, match.index);
        const context = `${lines[line - 2] ?? ""}\n${lines[line - 1] ?? ""}`;
        if (EXEMPT_MARKER.test(context) || EXEMPT_MARKER.test(text)) continue;
        flagged.push(`${rel}:${line} ${match[1]}(…)`);
      }
    }
  }
  return flagged.sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flagged = findUnhiddenSpawns();
  console.log(`${flagged.length} spawn(s) without windowsHide`);
  for (const f of flagged) console.log(`  ${f}`);
  process.exitCode = flagged.length ? 1 : 0;
}
