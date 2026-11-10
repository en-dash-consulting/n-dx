/**
 * Changeset bodies follow `.claude/skills/ndx-release-notes/SKILL.md`.
 *
 * The public release summary is built from each changeset's lead sentence and
 * its markers, so a body that buries the effect, or a marker in the wrong
 * place, turns the summary back into a re-read of every PR. This suite holds
 * the parts of the skill a machine can check:
 *
 *   - The body is not empty.
 *   - It opens with `Internal:` / `Test-only:` (no user-visible change), or
 *     with a lead sentence of at most 30 words.
 *   - `Action needed:` starts its own paragraph, after the lead, with text
 *     after it — and never in an `Internal:`/`Test-only:` body.
 *   - `Internal:` / `Test-only:` appear only at the start of the body.
 *
 * Whether a change *needs* `Action needed:` is judgement the skill's
 * self-check covers; no test can decide it.
 *
 * Changesets written before the convention are listed in
 * `fixtures/changeset-body-grandfathered.json` and skipped. The list only
 * shrinks: a release consumes those files, and a stale name is ignored. Do
 * not add a new changeset to it — fix the body.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const CHANGESET_DIR = join(ROOT, ".changeset");
const GRANDFATHERED = new Set(
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/changeset-body-grandfathered.json"), "utf8")),
);

export const MAX_LEAD_WORDS = 30;
const INTERNAL_MARKER = /^(Internal|Test-only):/;
const ACTION_MARKER = "Action needed:";

/** The body after the frontmatter block, or null when there is no frontmatter. */
function bodyOf(text) {
  // An empty block (`---` twice) is a valid changeset that bumps nothing.
  const match = /^---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n?([\s\S]*)$/.exec(text);
  return match ? match[1].trim() : null;
}

/**
 * The first sentence of a paragraph. Code spans and common abbreviations are
 * masked first so `file.md` or `e.g.` does not end the sentence early.
 */
export function leadSentence(paragraph) {
  const masked = paragraph
    .replace(/`[^`]*`/g, "CODE")
    .replace(/\b(e\.g|i\.e|etc|vs)\./g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const end = /[.!?](?=\s|$)/.exec(masked);
  return end ? masked.slice(0, end.index + 1) : masked;
}

/** Problems with one changeset's text; an empty list means it passes. */
export function changesetBodyProblems(text) {
  const body = bodyOf(text);
  if (body === null) return ["no frontmatter block"];
  if (body === "") return ["empty body: start with a lead sentence, or `Internal:` / `Test-only:`"];

  const problems = [];
  const paragraphs = body.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  const [first, ...rest] = paragraphs;
  const internal = INTERNAL_MARKER.test(first);

  if (internal) {
    if (first.replace(INTERNAL_MARKER, "").trim() === "") {
      problems.push("`Internal:` / `Test-only:` marker has no text after it");
    }
  } else {
    if (first.startsWith(ACTION_MARKER)) {
      problems.push("body opens with `Action needed:`; put the lead sentence first");
    }
    const words = leadSentence(first).split(" ").filter(Boolean).length;
    if (words > MAX_LEAD_WORDS) {
      problems.push(`lead sentence is ${words} words; keep it to ${MAX_LEAD_WORDS} or fewer and move mechanism to a later paragraph`);
    }
  }

  for (const paragraph of rest) {
    if (INTERNAL_MARKER.test(paragraph)) {
      problems.push("`Internal:` / `Test-only:` must open the body, not a later paragraph");
    }
  }

  const actionParagraphs = paragraphs.filter((p) => p.startsWith(ACTION_MARKER));
  if (body.split(ACTION_MARKER).length - 1 > actionParagraphs.length) {
    problems.push("`Action needed:` must start its own paragraph");
  }
  for (const paragraph of actionParagraphs) {
    if (paragraph.slice(ACTION_MARKER.length).trim() === "") {
      problems.push("`Action needed:` has no remedy after it");
    }
  }
  if (internal && actionParagraphs.length > 0) {
    problems.push("an `Internal:` / `Test-only:` change cannot also need user action");
  }
  return problems;
}

const fm = '---\n"@n-dx/core": patch\n---\n\n';

describe("changesetBodyProblems", () => {
  it("passes a lead sentence, an action paragraph and detail", () => {
    expect(
      changesetBodyProblems(
        `${fm}\`ndx start\` now asks for a token on every request.\n\nAction needed: re-register HTTP MCP clients with \`--header\`.\n\nDetail about \`auth.token\` and e.g. sessions.\n`,
      ),
    ).toEqual([]);
  });

  it("passes internal and test-only bodies", () => {
    expect(changesetBodyProblems(`${fm}Internal: refactor the brief builder.\n`)).toEqual([]);
    expect(changesetBodyProblems(`${fm}Test-only: stop a suite reading HOME.\n`)).toEqual([]);
  });

  it("does not end the lead at a dotted path or an abbreviation", () => {
    expect(leadSentence("Reads `.n-dx.json` (e.g. `web.port`) first. Then more.")).toBe("Reads CODE (e.g CODE) first.");
  });

  it("flags an empty body and a missing frontmatter block", () => {
    expect(changesetBodyProblems(`${fm}`)).toHaveLength(1);
    expect(changesetBodyProblems("no frontmatter")).toEqual(["no frontmatter block"]);
    expect(changesetBodyProblems("---\n---\n\nTest-only: bumps nothing.\n")).toEqual([]);
  });

  it("flags a lead over the word limit", () => {
    const long = Array.from({ length: MAX_LEAD_WORDS + 1 }, () => "word").join(" ");
    expect(changesetBodyProblems(`${fm}${long}.\n`)[0]).toMatch(/lead sentence is 31 words/);
  });

  it("flags misplaced and empty markers", () => {
    expect(changesetBodyProblems(`${fm}Action needed: run x.\n`)).toContainEqual(expect.stringMatching(/opens with `Action needed:`/));
    expect(changesetBodyProblems(`${fm}Lead. Action needed: run x.\n`)).toContainEqual(expect.stringMatching(/its own paragraph/));
    expect(changesetBodyProblems(`${fm}Lead.\n\nAction needed:\n`)).toContainEqual(expect.stringMatching(/no remedy/));
    expect(changesetBodyProblems(`${fm}Lead.\n\nInternal: also this.\n`)).toContainEqual(expect.stringMatching(/must open the body/));
    expect(changesetBodyProblems(`${fm}Internal:\n`)).toContainEqual(expect.stringMatching(/no text after it/));
    expect(changesetBodyProblems(`${fm}Internal: x.\n\nAction needed: y.\n`)).toContainEqual(expect.stringMatching(/cannot also need user action/));
  });
});

describe(".changeset/ bodies follow the ndx-release-notes skill", () => {
  const files = readdirSync(CHANGESET_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");

  it("every changeset not grandfathered passes", () => {
    const failures = files
      .filter((f) => !GRANDFATHERED.has(f))
      .flatMap((f) => changesetBodyProblems(readFileSync(join(CHANGESET_DIR, f), "utf8")).map((p) => `.changeset/${f}: ${p}`));
    expect(
      failures,
      "Fix these bodies per .claude/skills/ndx-release-notes/SKILL.md. Do not add new files to the grandfather list.",
    ).toEqual([]);
  });
});
