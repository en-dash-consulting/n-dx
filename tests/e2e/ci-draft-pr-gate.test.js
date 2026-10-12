/**
 * Draft pull requests cannot merge, so PR-triggered workflows skip them to save
 * Actions minutes, without skipping main or the merge queue. Read as text: no
 * YAML dependency.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const read = (name) => readFileSync(join(ROOT, ".github/workflows", name), "utf-8");

/** Lines of the top-level `on:` block (up to the next top-level key). */
function onBlock(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  expect(start, "no top-level `on:` block").toBeGreaterThanOrEqual(0);
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l) && !l.startsWith("#")) break;
    body.push(l);
  }
  return body;
}

/** Lines of a job: from `  <job>:` to the next two-space-indented key. */
function jobBlock(text, job) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${job}:`);
  expect(start, `no job ${job}`).toBeGreaterThanOrEqual(0);
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^ {0,2}[A-Za-z_-]+:/.test(l)) break;
    body.push(l);
  }
  return body;
}

const WORKFLOWS = [
  { file: "ci.yml", jobs: ["build", "smoke-parity"] },
  { file: "codeql.yml", jobs: ["analyze"] },
  { file: "dependency-review.yml", jobs: ["dependency-review"] },
];

describe.each(WORKFLOWS)("$file draft gate", ({ file, jobs }) => {
  const text = read(file);

  it("pull_request types include the draft transitions and GitHub's defaults", () => {
    const body = onBlock(text);
    const at = body.findIndex((l) => /^ {2}pull_request:/.test(l));
    expect(at, "on: block lacks pull_request:").toBeGreaterThanOrEqual(0);
    const types = body.slice(at + 1).find((l) => /^ {4}types:/.test(l));
    expect(types, "pull_request has no types: line").toBeDefined();
    for (const t of ["opened", "synchronize", "reopened", "ready_for_review", "converted_to_draft"]) {
      expect(types, `types: lacks ${t}`).toMatch(new RegExp(`\\b${t}\\b`));
    }
  });

  it.each(jobs)("job %s skips drafts only for pull_request events", (job) => {
    const ifLine = jobBlock(text, job).find((l) => /^ {4}if:/.test(l));
    expect(ifLine, `${job} has no job-level if:`).toBeDefined();
    expect(ifLine).toContain("github.event_name != 'pull_request'");
    expect(ifLine).toContain("github.event.pull_request.draft == false");
  });
});

// On push, merge_group and schedule events the PR context is null, so a bare
// `pull_request.draft == false` is false there: main CI would be skipped and the
// merge queue would wait forever on its required checks.
describe.each(["ci.yml", "codeql.yml"])("%s bare draft check", (file) => {
  it("never checks pull_request.draft without github.event_name", () => {
    const bare = read(file)
      .split("\n")
      .filter((l) => /^\s*(-\s*)?if:/.test(l))
      .filter((l) => l.includes("pull_request.draft") && !l.includes("github.event_name"));
    expect(bare).toEqual([]);
  });
});
