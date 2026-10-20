/**
 * Every CI leg that runs a suite with skipUnlessGrammar tests must build the
 * grammars and set SV_REQUIRE_GRAMMARS=1 first, in the same job (a GITHUB_ENV
 * export reaches only later steps of its own job). Without them those tests
 * skip and CI stays green — the #762 defect, and the PR 12a one where the
 * packs' suites moved to a group the steps did not cover.
 *
 * ci.yml is read as text (no YAML dependency at the root), so this parses only
 * the shapes the workflow uses and fails loudly on any `if:` it cannot evaluate.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { grammarSuites, needsGrammars } from "../../scripts/grammar-suites.mjs";

const ROOT = join(import.meta.dirname, "../..");
// A Windows checkout (core.autocrlf=true) gives ci.yml CRLF line endings.
const CI = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf-8").replace(/\r\n/g, "\n");
const RUNNER = "scripts/run-all-tests.mjs";
const DECIDER = "scripts/grammar-suites.mjs";

const indentOf = (line) => line.length - line.trimStart().length;
const meaningful = (line) => line.trim() !== "" && !line.trimStart().startsWith("#");
const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, "$2");
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `{ name: lines }` for each job under the top-level `jobs:`. */
function parseJobs(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) throw new Error("ci.yml has no top-level `jobs:`");
  const jobs = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (meaningful(line) && indentOf(line) === 0) break;
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs[current] = [];
    } else if (current) {
      jobs[current].push(line);
    }
  }
  return jobs;
}

/** The lines nested under `key:` at `indent` inside `lines`. */
function block(lines, key, indent) {
  const at = lines.findIndex((l) => l === `${" ".repeat(indent)}${key}:` || l.startsWith(`${" ".repeat(indent)}${key}: #`));
  if (at < 0) return null;
  const body = [];
  for (const line of lines.slice(at + 1)) {
    if (meaningful(line) && indentOf(line) <= indent) break;
    body.push(line);
  }
  return body;
}

/** Steps of a job: `{ name, id, if, run, index }`, with block scalars joined. */
function parseSteps(jobLines) {
  const stepsBlock = block(jobLines, "steps", 4) ?? [];
  const steps = [];
  let current = null;
  let scalarKey = null;
  for (const line of stepsBlock) {
    const item = /^ {6}- (.*)$/.exec(line);
    if (item) {
      current = { index: steps.length, run: "" };
      steps.push(current);
      scalarKey = null;
      readStepKey(current, item[1]);
      continue;
    }
    if (!current || !meaningful(line)) continue;
    if (indentOf(line) === 8) {
      scalarKey = readStepKey(current, line.trim());
    } else if (scalarKey && indentOf(line) > 8) {
      current[scalarKey] += `${line.trim()}\n`;
    }
  }
  return steps;
}

/** Records one `key: value` of a step; returns the key when its value is a block scalar. */
function readStepKey(step, text) {
  const kv = /^([\w-]+):\s*(.*)$/.exec(text);
  if (!kv) return null;
  const [, key, value] = kv;
  if (/^[|>][-+]?$/.test(value)) {
    step[key] = "";
    return key;
  }
  step[key] = unquote(value);
  return null;
}

/** A flow list `[a, b]` or a scalar. */
function parseValue(raw) {
  const text = raw.replace(/\s+#.*$/, "").trim();
  const flow = /^\[(.*)\]$/.exec(text);
  return flow ? flow[1].split(",").map(unquote) : unquote(text);
}

/**
 * The matrix combinations of a job, expanded the way GitHub Actions does: the
 * product of the list keys, then each `include` entry merged into every
 * combination whose original keys it matches, or added on its own when it
 * matches none.
 */
function matrixCombinations(jobLines) {
  const strategy = block(jobLines, "strategy", 4);
  const matrix = strategy && block(strategy, "matrix", 6);
  if (!matrix) return [{}];

  const axes = {};
  const includes = [];
  let inInclude = false;
  for (const line of matrix.filter(meaningful)) {
    const indent = indentOf(line);
    if (indent === 8) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line.trim());
      inInclude = kv[1] === "include";
      if (!inInclude) axes[kv[1]] = parseValue(kv[2]);
      continue;
    }
    if (!inInclude) continue;
    const entry = /^- (.*)$/.exec(line.trim());
    if (entry) includes.push({});
    const kv = /^([\w-]+):\s*(.*)$/.exec(entry ? entry[1] : line.trim());
    if (kv) includes[includes.length - 1][kv[1]] = parseValue(kv[2]);
  }

  let combos = [{}];
  for (const [key, values] of Object.entries(axes)) {
    const list = Array.isArray(values) ? values : [values];
    combos = combos.flatMap((c) => list.map((v) => ({ ...c, [key]: v })));
  }
  const original = combos.map((c) => ({ ...c }));
  for (const entry of includes) {
    let matched = false;
    combos.forEach((combo, i) => {
      const fits = Object.entries(entry).every(([k, v]) => !(k in original[i]) || original[i][k] === v);
      if (fits) {
        matched = true;
        Object.assign(combo, entry);
      }
    });
    if (!matched) combos.push({ ...entry });
  }
  return combos;
}

/** Replaces `${{ matrix.x }}` in `text` with the combination's values. */
function substitute(text, combo, where) {
  return text.replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_, key) => {
    if (!(key in combo)) throw new Error(`${where}: matrix.${key} is undefined for ${JSON.stringify(combo)}`);
    return combo[key];
  });
}

/** Comma-separated suite labels a run-all-tests step runs for `combo`. */
function suitesRun(step, combo, where) {
  const match = new RegExp(`${escapeRegExp(RUNNER)}[ \\t]+(\\S+)`).exec(substitute(step.run, combo, where));
  return match ? match[1] : "all";
}

/**
 * Evaluates a step's `if:` for one combination. Supports: no `if:`;
 * `contains(matrix.<key>, '<text>')` terms joined by `||` (a case-insensitive
 * substring test, as GitHub evaluates it on a string); and
 * `steps.<id>.outputs.<name> == 'true'` where step <id> writes `<name>=` from
 * scripts/grammar-suites.mjs.
 */
function stepRuns(step, steps, combo, where) {
  if (step.if === undefined) return true;
  const terms = step.if.split("||").map((t) => /^contains\(matrix\.([\w-]+),\s*'([^']*)'\)$/.exec(t.trim()));
  if (terms.every(Boolean)) {
    return terms.some(([, key, text]) => String(combo[key] ?? "").toLowerCase().includes(text.toLowerCase()));
  }
  const output = /^steps\.([\w-]+)\.outputs\.([\w-]+)\s*==\s*'true'$/.exec(step.if.trim());
  if (!output) {
    throw new Error(`${where}: cannot evaluate \`if: ${step.if}\` on "${step.name}"; teach tests/e2e/ci-grammar-steps.test.js the form or use the ${DECIDER} output`);
  }
  const [, id, name] = output;
  const decider = steps.find((s) => s.id === id);
  if (!decider) throw new Error(`${where}: "${step.name}" reads steps.${id}, but no step has id ${id}`);
  if (decider.index > step.index) throw new Error(`${where}: step ${id} runs after "${step.name}", which reads its output`);
  const call = new RegExp(`${name}=\\$\\(node ${escapeRegExp(DECIDER)} ([^\\s)]+)\\)`).exec(substitute(decider.run, combo, where));
  if (!call || !decider.run.includes("GITHUB_OUTPUT")) {
    throw new Error(`${where}: step ${id} must write ${name}=$(node ${DECIDER} <suites>) to $GITHUB_OUTPUT`);
  }
  // An empty or stray answer would skip the grammar steps and leave CI green.
  if (!/true\|false\)/.test(decider.run) || !/exit 1/.test(decider.run)) {
    throw new Error(`${where}: step ${id} must fail unless ${DECIDER} prints true or false`);
  }
  return needsGrammars(call[1]);
}

const BUILD = (s) => /\brun build:grammars\b/.test(s.run);
const REQUIRE = (s) => /SV_REQUIRE_GRAMMARS=1/.test(s.run) && /GITHUB_ENV/.test(s.run);

/** Problems with one job, one string per combination that lacks a step. */
function grammarStepProblems(jobName, jobLines) {
  const steps = parseSteps(jobLines);
  const problems = [];
  for (const run of steps.filter((s) => s.run.includes(RUNNER))) {
    for (const combo of matrixCombinations(jobLines)) {
      const where = `job ${jobName} ${JSON.stringify(combo)}`;
      const suites = suitesRun(run, combo, where);
      const wanted = suites === "all" || suites.split(",").some((l) => grammarSuites().includes(l.trim()));
      if (!wanted || !stepRuns(run, steps, combo, where)) continue;
      for (const [label, matches] of [["grammar build (`run build:grammars`)", BUILD], ["SV_REQUIRE_GRAMMARS=1 export", REQUIRE]]) {
        const ok = steps.some((s) => matches(s) && s.index < run.index && stepRuns(s, steps, combo, where));
        if (!ok) problems.push(`${where}: "${substitute(run.name, combo, where)}" runs ${suites} with no ${label} before it in the same job`);
      }
    }
  }
  return problems;
}

/** Package directories whose tests call the grammar gate. */
function packagesUsingGrammarGate() {
  const found = [];
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).some((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return e.name !== "node_modules" && walk(path);
      return /\.[cm]?[jt]s$/.test(e.name) && /skipUnlessGrammar|SV_REQUIRE_GRAMMARS/.test(readFileSync(path, "utf-8"));
    });
  for (const dir of readdirSync(join(ROOT, "packages"))) {
    const tests = join(ROOT, "packages", dir, "tests");
    if (existsSync(tests) && walk(tests)) found.push(dir);
  }
  return found.sort();
}

describe("ci.yml grammar steps", () => {
  it("derives the grammar suites from every package whose tests use the grammar gate", () => {
    const gated = packagesUsingGrammarGate();
    expect(gated.length).toBeGreaterThan(0);
    expect(grammarSuites()).toEqual(expect.arrayContaining(gated));
  });

  it("builds grammars and requires them before every run that includes a grammar suite", () => {
    const jobs = parseJobs(CI);
    const runningJobs = Object.entries(jobs).filter(([, lines]) => parseSteps(lines).some((s) => s.run.includes(RUNNER)));
    expect(runningJobs.length, `no ci.yml job runs ${RUNNER}`).toBeGreaterThan(0);
    const problems = runningJobs.flatMap(([name, lines]) => grammarStepProblems(name, lines));
    expect(problems).toEqual([]);
  });
});

describe("the guard itself", () => {
  const job = (steps, matrix = "") =>
    `jobs:\n  test:\n    runs-on: x\n${matrix}    steps:\n${steps}`;
  const MATRIX = [
    "    strategy:",
    "      matrix:",
    "        os: [a, b]",
    "        group: [one, two]",
    "        include:",
    "          - group: one",
    "            suites: root,lang-java",
    "          - group: two",
    "            suites: hench",
    "",
  ].join("\n");
  const DECIDE = [
    "      - name: Decide",
    "        id: grammars",
    "        shell: bash",
    "        run: |",
    "          build=$(node scripts/grammar-suites.mjs ${{ matrix.suites }})",
    `          case "$build" in true|false) ;; *) exit 1 ;; esac`,
    '          echo "build=$build" >> "$GITHUB_OUTPUT"',
  ];
  const GUARDED = [
    "      - name: Build tree-sitter grammars",
    "        if: steps.grammars.outputs.build == 'true'",
    "        run: pnpm -r --workspace-concurrency=1 run build:grammars",
    "      - name: Require built grammars in tests",
    "        if: steps.grammars.outputs.build == 'true'",
    "        shell: bash",
    '        run: echo "SV_REQUIRE_GRAMMARS=1" >> "$GITHUB_ENV"',
  ];
  const RUN = ["      - name: Run", "        run: node scripts/run-all-tests.mjs ${{ matrix.suites }}"];
  const problemsOf = (text) =>
    Object.entries(parseJobs(text)).flatMap(([name, lines]) => grammarStepProblems(name, lines));

  it("expands include entries into the matrix", () => {
    const combos = matrixCombinations(parseJobs(job("", MATRIX)).test);
    expect(combos).toHaveLength(4);
    expect(combos.filter((c) => c.suites === "root,lang-java")).toHaveLength(2);
  });

  it("passes when the steps precede the run for the grammar groups", () => {
    expect(problemsOf(job([...DECIDE, ...GUARDED, ...RUN].join("\n") + "\n", MATRIX))).toEqual([]);
  });

  it("names each combination when the steps come after the run", () => {
    const problems = problemsOf(job([...DECIDE, ...RUN, ...GUARDED].join("\n") + "\n", MATRIX));
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toContain('"os":"b","group":"one"');
    expect(problems.join("\n")).not.toContain('"group":"two"');
  });

  it("fails when the steps are in another job", () => {
    const text = [
      "jobs:",
      "  build:",
      "    steps:",
      ...DECIDE,
      ...GUARDED,
      "  test:",
      MATRIX.trimEnd(),
      "    steps:",
      ...RUN,
      "",
    ].join("\n");
    expect(problemsOf(text)).toHaveLength(4);
  });

  it("fails when a grammar suite sits in a group the steps skip", () => {
    const bySuite = GUARDED.map((l) => l.replace(/if: .*/, "if: contains(matrix.suites, 'sourcevision')"));
    const problems = problemsOf(job([...bySuite, ...RUN].join("\n") + "\n", MATRIX));
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toContain('"group":"one"');
  });

  it("reads a CRLF workflow the same as an LF one", () => {
    const text = job([...DECIDE, ...RUN, ...GUARDED].join("\n") + "\n", MATRIX);
    expect(problemsOf(text.replace(/\n/g, "\r\n"))).toEqual(problemsOf(text));
    expect(problemsOf(text)).toHaveLength(4);
  });

  it("refuses a decider that does not fail on an empty answer", () => {
    const unchecked = [
      ...DECIDE.slice(0, 3),
      '        run: echo "build=$(node scripts/grammar-suites.mjs ${{ matrix.suites }})" >> "$GITHUB_OUTPUT"',
    ];
    expect(() => problemsOf(job([...unchecked, ...GUARDED, ...RUN].join("\n") + "\n", MATRIX))).toThrow(/must fail unless/);
  });

  it("refuses an if: it cannot evaluate", () => {
    const text = job([...DECIDE, ...GUARDED.map((l) => l.replace(/if: .*/, "if: runner.os == 'Linux'")), ...RUN].join("\n") + "\n", MATRIX);
    expect(() => problemsOf(text)).toThrow(/cannot evaluate/);
  });
});
