/**
 * ci.yml's two changeset steps must keep their fixes: "Forbid edits to
 * existing changesets" fails a PR that edits a changeset already on main, and
 * "Validate changesets" skips `changeset status` on the version PR, detected
 * by content because merge_group runs have no head_ref. Read as text: no YAML
 * dependency. The checks are pure functions over the text, so they are also
 * run on mutated copies to prove each regression is caught.
 *
 * @see scripts/changeset-pr-checks.mjs
 * @see tests/unit/changeset-pr-checks.test.js — the classifiers themselves
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf-8").replace(/\r\n/g, "\n");

const GUARD = "Forbid edits to existing changesets";
const VALIDATE = "Validate changesets";
const STEP_START = /^ {6}- name: /;

/** A step's lines, from its `- name:` line up to the next step or job; null when absent. */
function stepLines(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => STEP_START.test(l) && l.slice(l.indexOf(":") + 1).trim() === name);
  if (start < 0) return null;
  const body = [lines[start]];
  for (const l of lines.slice(start + 1)) {
    if (STEP_START.test(l) || /^ {0,5}\S/.test(l)) break;
    body.push(l);
  }
  return body;
}

/** The step's `if:` expression, joined across continuation lines; "" when it has none. */
function ifCondition(lines) {
  const start = lines.findIndex((l) => /^ {8}if:/.test(l));
  if (start < 0) return "";
  const parts = [lines[start].replace(/^ {8}if:/, "")];
  for (const l of lines.slice(start + 1)) {
    if (!/^ {9,}\S/.test(l)) break;
    parts.push(l);
  }
  return parts.join(" ").trim();
}

/** The step without comment lines, so prose cannot satisfy a check. */
function code(lines) {
  return lines.filter((l) => !l.trim().startsWith("#")).join("\n");
}

/** Problems with the two changeset steps in a ci.yml text; empty when it holds. */
function changesetStepProblems(text) {
  const problems = [];
  const guard = stepLines(text, GUARD);
  if (!guard) {
    problems.push(`no "${GUARD}" step`);
  } else {
    const run = code(guard);
    for (const needle of ["git diff", "--diff-filter=MR", "origin/main...HEAD", "no-changeset-edits"]) {
      if (!run.includes(needle)) problems.push(`"${GUARD}" does not contain ${needle}`);
    }
  }
  const validate = stepLines(text, VALIDATE);
  if (!validate) {
    problems.push(`no "${VALIDATE}" step`);
  } else {
    const run = code(validate);
    const check = run.indexOf("is-version-pr");
    const status = run.indexOf("changeset status --since=origin/main");
    if (check < 0) problems.push(`"${VALIDATE}" does not call is-version-pr`);
    if (status < 0) problems.push(`"${VALIDATE}" does not run changeset status --since=origin/main`);
    if (check >= 0 && status >= 0 && check > status) problems.push(`"${VALIDATE}" calls is-version-pr after changeset status`);
  }
  for (const [name, lines] of [[GUARD, guard], [VALIDATE, validate]]) {
    const condition = lines ? ifCondition(lines) : "";
    if (condition.includes("github.head_ref") && !condition.includes("github.event_name == 'pull_request'")) {
      problems.push(`"${name}" tests github.head_ref without github.event_name == 'pull_request' (empty in merge_group)`);
    }
  }
  return problems;
}

/** ci.yml text with one step's lines passed through `edit`. */
function editStep(text, name, edit) {
  const lines = stepLines(text, name);
  expect(lines, `ci.yml has no "${name}" step`).not.toBeNull();
  return text.replace(lines.join("\n"), edit(lines).join("\n"));
}

describe("ci.yml changeset steps", () => {
  it("keeps the edit guard and the version-PR exemption", () => {
    expect(changesetStepProblems(ci)).toEqual([]);
  });

  it("rejects a copy with the guard step removed", () => {
    const mutated = editStep(ci, GUARD, () => []);
    expect(changesetStepProblems(mutated)).toEqual([`no "${GUARD}" step`]);
  });

  it("rejects a copy with the is-version-pr call removed", () => {
    const mutated = editStep(ci, VALIDATE, (lines) =>
      lines.map((l) => l.replace("node scripts/changeset-pr-checks.mjs is-version-pr", "false")),
    );
    expect(changesetStepProblems(mutated)).toEqual([`"${VALIDATE}" does not call is-version-pr`]);
  });

  it.each([GUARD, VALIDATE])("rejects a bare github.head_ref condition on %s", (name) => {
    const mutated = editStep(ci, name, (lines) =>
      lines.map((l) => (/^ {8}if:/.test(l) ? `${l} && github.head_ref != 'changeset-release/main'` : l)),
    );
    expect(changesetStepProblems(mutated)).toEqual([
      `"${name}" tests github.head_ref without github.event_name == 'pull_request' (empty in merge_group)`,
    ]);
  });

  it("accepts a head_ref condition gated on pull_request", () => {
    const mutated = editStep(ci, VALIDATE, (lines) =>
      lines.map((l) => (/^ {8}if:/.test(l) ? `${l} && github.event_name == 'pull_request' && github.head_ref != 'x'` : l)),
    );
    expect(changesetStepProblems(mutated)).toEqual([]);
  });
});
