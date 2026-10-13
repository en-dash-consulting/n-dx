/**
 * Draft pull requests cannot merge, so PR-triggered workflows skip them to save
 * Actions minutes, without skipping main or the merge queue. Read as text: no
 * YAML dependency.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
// Windows runners check the workflows out with CRLF; every match below is line-exact.
const read = (name) =>
  readFileSync(join(ROOT, ".github/workflows", name), "utf-8").replace(/\r\n/g, "\n");

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

/** Text with each folded `if: >-` block collapsed onto one line. */
function foldIfs(text) {
  return text.replace(/^(\s*(?:-\s*)?if:) >-\n((?:[ \t]+\S.*\n?)+)/gm, (_, head, rest) =>
    `${head} ${rest.trim().split("\n").map((l) => l.trim()).join(" ")}\n`,
  );
}

/** Job ids: the two-space-indented keys under the top-level `jobs:` block. */
function jobIds(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  expect(start, "no top-level `jobs:` block").toBeGreaterThanOrEqual(0);
  const ids = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l) && !l.startsWith("#")) break;
    const m = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(l);
    if (m) ids.push(m[1]);
  }
  return ids;
}

// Jobs are discovered, not listed, so a job added later fails until it is gated.
// A job that must legitimately run on drafts goes here, per file, with the reason.
const DRAFT_EXEMPT = {};

const WORKFLOWS = ["ci.yml", "codeql.yml", "dependency-review.yml"].map((file) => ({
  file,
  jobs: jobIds(read(file)).filter((j) => !(DRAFT_EXEMPT[file] ?? []).includes(j)),
}));

describe.each(WORKFLOWS)("$file draft gate", ({ file, jobs }) => {
  const text = read(file);

  it("has jobs to gate", () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

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
    const ifLine = jobBlock(foldIfs(text), job).find((l) => /^ {4}if:/.test(l));
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
    const bare = foldIfs(read(file))
      .split("\n")
      .filter((l) => /^\s*(-\s*)?if:/.test(l))
      .filter((l) => l.includes("pull_request.draft") && !l.includes("github.event_name"));
    expect(bare).toEqual([]);
  });
});

// Manual ways to run CI on a draft: the `ci:run` label (one-shot) and the Run
// workflow button. Neither may reach the other workflows or cancel a real run.
describe("ci.yml manual triggers", () => {
  const text = read("ci.yml");
  const body = onBlock(text);

  it("declares workflow_dispatch", () => {
    expect(body.some((l) => /^ {2}workflow_dispatch:/.test(l))).toBe(true);
  });

  it("pull_request types include labeled and not unlabeled", () => {
    const at = body.findIndex((l) => /^ {2}pull_request:/.test(l));
    const types = body.slice(at + 1).find((l) => /^ {4}types:/.test(l));
    expect(types).toMatch(/\blabeled\b/);
    expect(types).not.toMatch(/\bunlabeled\b/);
  });

  it.each(["build", "test", "smoke-parity"])("job %s admits the ci:run label and keeps the event guard", (job) => {
    const ifLine = jobBlock(foldIfs(text), job).find((l) => /^ {4}if:/.test(l));
    expect(ifLine).toContain("github.event.label.name == 'ci:run'");
    expect(ifLine).toContain("github.event_name != 'pull_request'");
  });

  // The group is evaluated before job `if:`s. A labeled event that runs
  // nothing would cancel the PR's real run, and a dispatch run shares
  // github.ref with a push to the same branch.
  it("concurrency group isolates no-op label events and dispatch runs", () => {
    const group = text.split("\n").find((l) => /^ {2}group:/.test(l));
    expect(group, "no concurrency group").toBeDefined();
    expect(group).toContain("github.run_id");
    expect(group).toContain("github.event.action == 'labeled'");
    expect(group).toContain("github.event_name == 'workflow_dispatch'");
  });

  it.each(["codeql.yml", "dependency-review.yml"])("%s is not started by a label", (file) => {
    expect(onBlock(read(file)).join("\n")).not.toMatch(/\blabeled\b/);
  });
});
