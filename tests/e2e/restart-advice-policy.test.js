/**
 * Restart-advice policy: no user-facing message in packages/core or
 * packages/web/src gives a manual rebuild or restart as the fix.
 *
 * n-dx used to answer a stale build or an old hub by telling the operator to
 * run `pnpm build`, then `ndx hub stop` (which stops every project on the
 * machine), then `ndx start`. The commands now recover on their own: a
 * source-linked install rebuilds a stale `dist/`, `ndx start` replaces a hub
 * that is not the one it would start, and the hub repairs what it can. A new
 * message that hands that work back to the operator fails here.
 *
 * What is scanned: every string literal (quoted or template, comments
 * excluded) in core's own modules and in web's `src/` — the text of thrown
 * errors, console output, API problem text and `lastError` all start there.
 * What fails: a literal that names `ndx hub stop`, `pnpm build` or
 * `pnpm install` (with or without `--filter`), tells the reader to restart the
 * hub or the server, or sequences a stop with a fresh `ndx start`.
 *
 * Exceptions are listed below, each with the reason it is not advice. One
 * that no longer matches anything fails too, so the list cannot rot.
 *
 * @see .rex/changes/n-dx-recovers-from-a-stale-build-or/index.md — the inventory this replaced
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/** TESTING.md, Family 2: every absolute time budget is scaled through this. */
const BUDGET_MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);

/** Where user-facing strings live: core's own modules, and web's source. */
const SCANNED = [
  { dir: "packages/core", recurse: false, ext: /\.(m|c)?js$/ },
  { dir: "packages/core/bin", recurse: true, ext: /\.(m|c)?js$/ },
  { dir: "packages/web/src", recurse: true, ext: /\.(m|c)?[jt]sx?$/ },
];

/** Advice this policy forbids, each with what it is. */
export const FORBIDDEN = [
  { name: "ndx hub stop", pattern: /\bndx hub stop\b/ },
  { name: "pnpm build / install", pattern: /\bpnpm\s+(?:(?:--filter|-F)(?:\s*=\s*|\s+)[^\s=]\S*\s+|-r\s+|--recursive\s+|run\s+)*(?:build|install|i)\b/ },
  { name: "restart the hub or server", pattern: /(?<!without )\brestart(?:ing)?\s+(?:it\b|the hub\b|the server\b|the dashboard\b|n-dx\b|ndx\b|your server\b)/i },
  { name: "stop, then ndx start", pattern: /\bthen\s+['"`]?ndx start\b/ },
];

/**
 * Literals that match a pattern but are not advice to restart or rebuild.
 * `file` is relative to the repo root; `includes` is a fragment of the literal.
 */
export const EXCEPTIONS = [
  {
    file: "packages/core/help.js",
    includes: "'ndx hub stop' stops the hub and every project.",
    reason: "Help text for `ndx start`: describes what the `ndx hub stop` command does, not a fix for a fault.",
  },
  {
    file: "packages/core/help.js",
    includes: "ndx hub stop",
    exact: true,
    reason: "The `ndx hub` help's own example of its `stop` subcommand.",
  },
  {
    file: "packages/core/web.js",
    includes: "Stop: ${} .   (or 'ndx hub stop' for every project)",
    reason: "The `Stop:` line `ndx start` prints names the commands that stop what it started; it describes them, it does not prescribe them as a fix.",
  },
  {
    file: "packages/core/web.js",
    includes: "without a PID file — restarting it…",
    reason: "Progress: `ndx start --here` restarting this directory's own untracked server itself, as its contract says; nothing is asked of the operator.",
  },
];

/** Every source file under one scanned root. */
function filesUnder({ dir, recurse, ext }) {
  const out = [];
  const walk = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (recurse) walk(full);
      } else if (ext.test(entry.name) && !/\.(test|spec)\./.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/**
 * The string literals in a JS/TS source, with the line each starts on.
 * Comments are skipped. A template literal's `${…}` expressions are scanned
 * as code (they can hold literals of their own) and stand as `${}` in the
 * template's text. A `/` starts a regular expression where an expression may
 * begin, so quotes inside one are not read as strings.
 *
 * @param {string} source
 * @returns {Array<{ text: string, line: number }>}
 */
export function stringLiterals(source) {
  const literals = [];
  let line = 1;
  let i = 0;
  /** Stack of open template literals: their text so far and start line, and the brace depth of the expression being scanned. */
  const templates = [];
  let braceDepth = 0;
  let prev = ""; // last significant code character, for the regex heuristic
  const n = source.length;

  const readQuoted = (quote) => {
    const start = line;
    let text = "";
    i++;
    while (i < n && source[i] !== quote) {
      if (source[i] === "\\") {
        text += source[i + 1] ?? "";
        if (source[i + 1] === "\n") line++;
        i += 2;
        continue;
      }
      if (source[i] === "\n") break; // unterminated: give up on this one
      text += source[i++];
    }
    i++;
    literals.push({ text, line: start });
  };

  /** Read template text up to its end or the next `${`; returns true when it ended. */
  const readTemplateText = (tpl) => {
    while (i < n) {
      const c = source[i];
      if (c === "\\") {
        tpl.text += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        return true;
      }
      if (c === "$" && source[i + 1] === "{") {
        tpl.text += "${}";
        i += 2;
        return false;
      }
      if (c === "\n") line++;
      tpl.text += c;
      i++;
    }
    return true;
  };

  const startTemplate = () => {
    const tpl = { text: "", line };
    i++;
    if (readTemplateText(tpl)) literals.push({ text: tpl.text, line: tpl.line });
    else templates.push({ tpl, depth: braceDepth++ });
  };

  while (i < n) {
    const c = source[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') { readQuoted(c); prev = "a"; continue; }
    if (c === "`") { startTemplate(); prev = "a"; continue; }
    if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev))) {
      // A regular expression literal: skip it, classes and escapes included.
      i++;
      let inClass = false;
      while (i < n && source[i] !== "\n") {
        const r = source[i];
        if (r === "\\") { i += 2; continue; }
        if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(source[i])) i++;
      prev = "a";
      continue;
    }
    if (c === "{") braceDepth++;
    if (c === "}") {
      const open = templates[templates.length - 1];
      if (open && braceDepth - 1 === open.depth) {
        // The end of a template's `${…}`: back into its text.
        braceDepth--;
        i++;
        if (readTemplateText(open.tpl)) {
          templates.pop();
          literals.push({ text: open.tpl.text, line: open.tpl.line });
        } else {
          braceDepth++; // into the template's next `${…}`
        }
        prev = "a";
        continue;
      }
      braceDepth--;
    }
    // `return /re/` and friends: a keyword ends like an identifier, which
    // the heuristic reads as "not an expression start". Rare in this code.
    prev = /[A-Za-z0-9_$)\]]/.test(c) ? "a" : c;
    i++;
  }
  return literals;
}

/**
 * Every literal in `source` that matches a forbidden pattern.
 *
 * @param {string} source
 * @returns {Array<{ text: string, line: number, rule: string }>}
 */
export function findRestartAdvice(source) {
  const found = [];
  for (const literal of stringLiterals(source)) {
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(literal.text)) found.push({ ...literal, rule: rule.name });
    }
  }
  return found;
}

function isException(file, text) {
  return EXCEPTIONS.find((e) => e.file === file && (e.exact ? text === e.includes : text.includes(e.includes)));
}

describe("restart-advice policy", () => {
  it("fails a newly added message that tells the operator to restart or rebuild by hand", () => {
    const added = [
      `throw new Error("Could not stop the sidecar; restart the hub with ndx hub stop");`,
      "console.error(`The hub is stale. Run 'pnpm --filter \"@n-dx/web...\" build', then 'ndx start'.`);",
      `const lastError = 'Restart it: ndx hub stop, then ndx start.';`,
      `log("Hint: Run 'pnpm install' (or 'pnpm build') from the repo root");`,
    ];
    for (const source of added) expect(findRestartAdvice(source).length, source).toBeGreaterThan(0);
  });

  it("matches a --filter value however it is joined, in linear time on input built to backtrack", () => {
    const pnpm = FORBIDDEN.find((rule) => rule.name === "pnpm build / install").pattern;
    for (const text of ["pnpm --filter=@n-dx/web build", "pnpm -F = @n-dx/web build", "pnpm -F @n-dx/web -r run build", "pnpm i"]) {
      expect(pnpm.test(text), text).toBe(true);
    }
    expect(pnpm.test("pnpm -F @n-dx/web test")).toBe(false);
    // CodeQL js/redos: an operator and value that two alternatives could both
    // split ('=' as the joiner, or as the value's first character).
    for (const unit of ["\t=! -F", " =! -F"]) {
      const started = performance.now();
      // A hang guardrail, not a speed claim: nothing can count the engine's
      // backtracking. Measured at 28 units: 5,699-7,075 ms with either
      // ambiguous pattern (`[\s=]+\S+` and `(?:\s*=\s*|\s+)\S+`), at most
      // 0.09 ms with the linear one, against a 500 ms default budget.
      expect(pnpm.test(`pnpm -F${unit.repeat(28)}`)).toBe(false);
      expect(performance.now() - started, JSON.stringify(unit)).toBeLessThan(25 * BUDGET_MULTIPLIER);
    }
  });

  it("reads strings, not comments, regular expressions or code", () => {
    const source = [
      "// restart the hub with ndx hub stop",
      "/* pnpm build */",
      "const re = /ndx hub stop/;",
      "const ok = 'the hub is replaced by the next start';",
      "const t = `port ${port} ${'nested'} done`;",
    ].join("\n");
    expect(findRestartAdvice(source)).toEqual([]);
    expect(stringLiterals(source).map((l) => l.text)).toEqual(["the hub is replaced by the next start", "nested", "port ${} ${} done"]);
  });

  it("finds no such message in packages/core or packages/web/src outside the listed exceptions", () => {
    const violations = [];
    const used = new Set();
    for (const root of SCANNED) {
      for (const abs of filesUnder(root)) {
        const file = relative(ROOT, abs).split("\\").join("/");
        for (const hit of findRestartAdvice(readFileSync(abs, "utf-8"))) {
          const exception = isException(file, hit.text);
          if (exception) used.add(exception);
          else violations.push(`${file}:${hit.line} [${hit.rule}] ${JSON.stringify(hit.text)}`);
        }
      }
    }
    expect(violations, `Messages that hand a rebuild or restart to the operator:\n${violations.join("\n")}`).toEqual([]);
    const stale = EXCEPTIONS.filter((e) => !used.has(e));
    expect(stale.map((e) => `${e.file}: ${e.includes}`), "Exceptions that no longer match anything — remove them").toEqual([]);
  });

  it("gives every exception a reason", () => {
    for (const e of EXCEPTIONS) expect(e.reason.length, `${e.file}: ${e.includes}`).toBeGreaterThan(20);
  });
});
