/**
 * The orchestration tier's commit-trailer builder, and the one-item rule.
 *
 * `N-DX-Item` is the only thing tying a commit to the PRD item it is for:
 * rex's `computeChangeCommits` asks git for `%(trailers:key=N-DX-Item)` and
 * reads no other part of the message. So two things have to hold, and both are
 * easy to break silently — a commit that should carry the trailer and does not
 * is invisible to the evidence layer, and a trailer in the wrong place is not
 * a trailer at all as far as git is concerned.
 *
 * The rule itself is stated in `packages/core/commit-trailers.js`: emit
 * `N-DX-Item` when the commit is for exactly one item; omit it for a
 * repository-level commit or one spanning several.
 *
 * @see tests/e2e/skill-commit-isolation.test.js — the same rule for skills
 * @see packages/hench/tests/integration/completion-metadata-commit.test.ts —
 *   the same rule for hench's PRD-record commit, asserted against real git
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCommitMessage,
  buildTrailerBlock,
  CO_AUTHORED_BY_TRAILER,
} from "../../packages/core/commit-trailers.js";

const ROOT = join(import.meta.dirname, "../..");

/**
 * The argument lists of every `buildCommitMessage(...)` call in `src`, each
 * split into top-level arguments.
 *
 * Scans to the matching close paren rather than matching `[^)]*`: the real
 * calls pass template literals containing parentheses
 * (`` `Deploy dashboard (${timestamp})` ``), which a non-nesting pattern cuts
 * in half and then miscounts.
 */
function buildCommitMessageArgs(src) {
  const calls = [];
  const needle = "buildCommitMessage(";
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + 1)) {
    // Skip the declaration and any re-export, which are not calls.
    if (/[\w$.]/.test(src[at - 1] ?? "")) continue;
    let depth = 0;
    const args = [""];
    for (let i = at + needle.length - 1; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) {
          calls.push(args.map((a) => a.trim()));
          break;
        }
      } else if (ch === "," && depth === 1) {
        args.push("");
        continue;
      }
      if (depth >= 1 && !(depth === 1 && ch === "(" && i === at + needle.length - 1)) {
        args[args.length - 1] += ch;
      }
    }
  }
  return calls;
}

/** Lines git will read as trailers: the run of `Key: value` lines ending the message. */
function trailerLines(message) {
  const lines = message.split("\n");
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === "") break;
    out.unshift(line);
  }
  return out;
}

describe("buildTrailerBlock", () => {
  it("emits provenance and co-authorship, in that order, with no item by default", () => {
    expect(buildTrailerBlock("init/baseline")).toBe(
      `N-DX: init/baseline\n${CO_AUTHORED_BY_TRAILER}`,
    );
  });

  it("emits N-DX-Item between them when the commit is for one item", () => {
    expect(buildTrailerBlock("export/dashboard", "5ee70ad3-313d-46f0")).toBe(
      `N-DX: export/dashboard\nN-DX-Item: 5ee70ad3-313d-46f0\n${CO_AUTHORED_BY_TRAILER}`,
    );
  });

  it("omits the line entirely for an absent or empty id, rather than emitting a valueless trailer", () => {
    // `N-DX-Item:` with nothing after it reads as an item whose id is the empty
    // string, which `itemIdFromTrailer` would reject anyway — but it would sit
    // in history looking like an attribution that failed.
    for (const id of [undefined, ""]) {
      expect(buildTrailerBlock("init/baseline", id)).not.toContain("N-DX-Item");
    }
  });
});

describe("buildCommitMessage", () => {
  it("separates subject from trailers with one blank line, and none inside the block", () => {
    const message = buildCommitMessage("chore: n-dx init", "init/baseline", "item-1");
    expect(message.split("\n")[1]).toBe("");
    // Every trailer must be in the final run of non-blank lines, or git stops
    // parsing at the first blank and the rest is body text.
    expect(trailerLines(message)).toEqual([
      "N-DX: init/baseline",
      "N-DX-Item: item-1",
      CO_AUTHORED_BY_TRAILER,
    ]);
  });

  it("puts the subject first and nothing before it", () => {
    expect(buildCommitMessage("chore: n-dx init", "init/baseline")).toMatch(
      /^chore: n-dx init\n\n/,
    );
  });
});

// ── The pull-request template ───────────────────────────────────────────────

/**
 * A PR's description becomes the body of the merge commit that lands on main,
 * so the template's trailer block is what puts `N-DX-Item` on that commit. A
 * template whose block git would not parse — a blank line inside it, or
 * anything after it — ships a trailer that silently never reaches history,
 * which is exactly the failure the evidence layer cannot see.
 */
describe("the pull-request template carries a trailer block", () => {
  const template = readFileSync(join(ROOT, ".github/pull_request_template.md"), "utf-8").replace(
    /\r\n/g,
    "\n",
  );

  it("ends with a trailer block containing N-DX-Item", () => {
    expect(trailerLines(template.trimEnd())).toContain("N-DX-Item: <item-id>");
  });

  it("puts nothing after the block that git would read as body text", () => {
    // Every line in the final run must be a `Key: value` trailer. A prose line
    // or a stray `-->` here ends the block for git.
    for (const line of trailerLines(template.trimEnd())) {
      expect(line, `"${line}" is not a trailer line`).toMatch(/^[A-Za-z][A-Za-z-]*: .+$/);
    }
  });

  it("tells the author to use the bare id and to delete the line when there is no single item", () => {
    expect(template).toMatch(/never a\s+dashboard URL/);
    expect(template).toMatch(/Delete the\s+line entirely/);
  });
});

// ── The rule applied to core's own commit paths ─────────────────────────────

/**
 * Core's three commit sites, and why each passes no item id. These are
 * repository-level commits: they exist before or outside any PRD item, so
 * there is no id to name. Asserting it keeps the module header honest — if a
 * site later gains an item, this test is what makes someone choose rather than
 * leave the trailer off by default.
 */
const CORE_COMMIT_SITES = [
  ["packages/core/git-preflight.js", "the `ndx init` baseline commit, made before any PRD exists"],
  ["packages/core/export.js", "the dashboard deploy commit, which publishes the whole PRD"],
  ["packages/core/migrate-layout.js", "the `.ndx/` layout move, which touches every item's file"],
];

describe("core's commit paths are repository-level and pass no item id", () => {
  // The assertion below is "every call has two arguments", which a scanner
  // that silently found nothing — or that cut a call in half at a nested paren
  // — would also satisfy. Pin the instrument against both shapes first.
  it("the scanner counts arguments through a nested paren", () => {
    const src = [
      "const a = buildCommitMessage(`Deploy dashboard (${timestamp})`, 'export/dashboard');",
      "const b = buildCommitMessage(subject, producer, itemId);",
      "export function buildCommitMessage(subject, producer, itemId) {}",
    ].join("\n");
    expect(buildCommitMessageArgs(src)).toEqual([
      ["`Deploy dashboard (${timestamp})`", "'export/dashboard'"],
      ["subject", "producer", "itemId"],
      ["subject", "producer", "itemId"],
    ]);
  });

  for (const [path, why] of CORE_COMMIT_SITES) {
    it(`${path}: calls buildCommitMessage with two arguments — ${why}`, () => {
      const calls = buildCommitMessageArgs(readFileSync(join(ROOT, path), "utf-8"));
      expect(calls.length, `no buildCommitMessage call found in ${path}`).toBeGreaterThan(0);
      for (const args of calls) {
        expect(
          args,
          `${path} passes an item id to buildCommitMessage. That is now ` +
            `supported — if this commit really is for exactly one PRD item, ` +
            `move the site out of CORE_COMMIT_SITES and say why here.`,
        ).toHaveLength(2);
      }
    });
  }
});
