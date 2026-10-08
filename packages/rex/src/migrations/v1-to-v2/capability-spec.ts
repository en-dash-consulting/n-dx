/**
 * Migration plan, specs: a present-tense draft for each planned capability.
 *
 * Pure and deterministic, like the classification it reads
 * (`./migration-plan.ts`). For each capability entry it drafts:
 *
 * - a **statement** in present tense: the first sentence of the v1 feature's
 *   description, unless that sentence describes work ("Add …"), in which case
 *   a placeholder built from the title, flagged for rewrite;
 * - EARS-style **criteria** from the acceptance criteria of the feature and of
 *   its applied history (the completed changes placed on it and their
 *   completed descendants). Unfinished work describes what is not built, so it
 *   contributes nothing;
 * - an **automated requirement** for each criterion whose words match test
 *   files the way `verify_criteria` matches them (`core/keywords.ts`), held to a
 *   stricter score so one shared word does not link a test.
 *
 * Code evidence comes from sourcevision, which rex may not import; the caller
 * passes it in per capability. Every draft has `specReviewed: false`: applying
 * the plan leaves `reviewedHash` unset, so the spec reads unreviewed until a
 * person reviews it.
 *
 * @module migrations/v1-to-v2/capability-spec
 */

import { posix } from "node:path";
import type { PRDItem, Requirement } from "../../schema/v1.js";
import type { Criterion } from "../../schema/v2.js";
import { extractKeywords, scoreMatch } from "../../core/keywords.js";
import { opensWithWorkVerb, type MigrationPlan } from "./migration-plan.js";

export interface SpecCriterion extends Criterion {
  /** Id of the automated requirement that checks it, when tests matched. */
  requirement?: string;
}

export interface CapabilitySpecDraft {
  /** v1 id of the capability entry. */
  capability: string;
  title: string;
  statement: string;
  criteria: SpecCriterion[];
  requirements: Requirement[];
  /** v1 ids drawn on: the capability, then its applied history in tree order. */
  sources: string[];
  /** Code files sourcevision ties to the capability. */
  codeFiles: string[];
  specReviewed: false;
  /** What a reviewer should look at; empty when nothing stands out. */
  notes: string[];
}

export interface SpecDraftOptions {
  /** Repository test files, relative paths (`findTestFiles`). */
  testFiles: readonly string[];
  /** Code files per capability (v1 id), from sourcevision file info. */
  codeFiles?: Readonly<Record<string, readonly string[]>>;
  /** Test command; when set, a requirement's `validationCommand` runs its linked tests. */
  testCommand?: string;
  /** Fewest criterion words a test path must contain to link. Default 2. */
  minTestScore?: number;
}

/**
 * Below this, a test shares one word with the criterion: on this repository
 * that links most of a package's tests to any criterion naming the package.
 */
const DEFAULT_MIN_TEST_SCORE = 2;
/** More equally good matches than this means the words are generic, not that the tests are linked. */
const MAX_LINKED_TESTS = 3;
const TEST_FILE_SUFFIX = /[._](?:test|spec)\.[cm]?[jt]sx?$/;

const EARS_OPENERS = /^(?:when|while|if|where)\b/i;
const TEST_MARKER = /\s*\((?:tests?|tested|unit tests?|e2e)\)$/i;
const TRAILING_PUNCTUATION = /[.;:\s]+$/;

function lowerFirst(text: string): string {
  // Leave acronyms ("MCP", "PRD") as written.
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/** Criterion text without its trailing "(test)" marker or punctuation, in either order. */
function criterionCore(text: string): string {
  return text.trim().replace(TRAILING_PUNCTUATION, "").replace(TEST_MARKER, "").replace(TRAILING_PUNCTUATION, "");
}

/** One criterion in EARS form: EARS-shaped text is kept, the rest wrapped in the ubiquitous form. */
export function toEars(text: string): string {
  const core = criterionCore(text);
  if (EARS_OPENERS.test(core) || /\bshall\b/i.test(core)) return `${core}.`;
  return `The system shall ensure that ${lowerFirst(core)}.`;
}

/** A sentence end, not the dot of an abbreviation ("e.g.", "i.e.", "etc.", "vs."). */
const SENTENCE_BREAK = /(?<!\b(?:e\.g|i\.e|etc|vs)\.)(?<=[.!?])\s+|\n/;
/** Review metadata or a reference, not a description of the product ("**Severity:** …", "Verdict: …", "GitHub #368."). */
const NOT_A_STATEMENT = /^(?:[#*>|`\-[]|(?:severity|verdict|priority|status|github|issue|pr)\b)/i;
const MIN_STATEMENT_WORDS = 4;

function firstSentence(text: string | undefined): string | undefined {
  const sentence = text?.trim().split(SENTENCE_BREAK)[0]?.trim();
  return sentence ? sentence : undefined;
}

function usableStatement(sentence: string | undefined): sentence is string {
  if (sentence === undefined || NOT_A_STATEMENT.test(sentence) || opensWithWorkVerb(sentence)) return false;
  return sentence.split(/\s+/).length >= MIN_STATEMENT_WORDS;
}

function draftStatement(item: PRDItem): { statement: string; fromTitle: boolean } {
  const sentence = firstSentence(item.description);
  if (usableStatement(sentence)) {
    return { statement: /[.!?]$/.test(sentence) ? sentence : `${sentence}.`, fromTitle: false };
  }
  const title = item.title.trim();
  // A Title Case name ("Hench Runtime Prompt Tightening") keeps its capitals.
  const titleCase = /\s[A-Z]/.test(title);
  return { statement: `The product provides ${titleCase ? title : lowerFirst(title)}.`, fromTitle: true };
}

/**
 * Test files whose names share the most criterion words, at or above the
 * minimum. Only the file name is scored: directory words (`packages`, `src`,
 * `unit`, a package name) match most criteria and so say nothing. A tie wider
 * than `MAX_LINKED_TESTS` is not a clear match and links nothing.
 */
function linkedTests(criterion: string, testFiles: readonly string[], minScore: number): string[] {
  const keywords = extractKeywords(criterion);
  if (keywords.length === 0) return [];
  let best = minScore;
  let files: string[] = [];
  for (const file of testFiles) {
    const score = scoreMatch(posix.basename(file).replace(TEST_FILE_SUFFIX, ""), keywords);
    if (score > best) {
      best = score;
      files = [file];
    } else if (score === best) {
      files.push(file);
    }
  }
  return files.length > MAX_LINKED_TESTS ? [] : files.sort();
}

function indexItems(items: readonly PRDItem[], into = new Map<string, PRDItem>()): Map<string, PRDItem> {
  for (const item of items) {
    into.set(item.id, item);
    indexItems(item.children ?? [], into);
  }
  return into;
}

/** The item and its completed descendants, depth first. */
function completedHistory(item: PRDItem, out: PRDItem[]): void {
  out.push(item);
  for (const child of item.children ?? []) {
    if (child.status === "completed") completedHistory(child, out);
  }
}

/** Draft a present-tense spec for every capability in the plan, in plan order. */
export function draftCapabilitySpecs(
  plan: MigrationPlan,
  items: readonly PRDItem[],
  options: SpecDraftOptions,
): CapabilitySpecDraft[] {
  const byId = indexItems(items);
  const minScore = options.minTestScore ?? DEFAULT_MIN_TEST_SCORE;

  return plan.entries
    .filter((e) => e.target === "capability")
    .map((entry) => {
      const item = byId.get(entry.id);
      if (!item) throw new Error(`capability ${entry.id} is not in the v1 tree the plan was built from`);

      const sources: PRDItem[] = [item];
      for (const change of plan.entries) {
        if (change.target !== "change" || change.placement !== entry.id || !change.applied) continue;
        const changeItem = byId.get(change.id);
        if (changeItem) completedHistory(changeItem, sources);
      }

      const criteria: SpecCriterion[] = [];
      const requirements: Requirement[] = [];
      const seen = new Set<string>();
      for (const source of sources) {
        for (const raw of source.acceptanceCriteria ?? []) {
          const text = toEars(raw);
          const key = text.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const criterion: SpecCriterion = { id: `c${criteria.length + 1}`, text };
          const tests = linkedTests(raw, options.testFiles, minScore);
          if (tests.length > 0) {
            const requirement: Requirement = {
              id: `${entry.id}:${criterion.id}`,
              title: criterionCore(raw),
              description: `Linked by keyword to: ${tests.join(", ")}`,
              category: "technical",
              validationType: "automated",
              acceptanceCriteria: [text],
              ...(options.testCommand ? { validationCommand: `${options.testCommand} ${tests.join(" ")}` } : {}),
            };
            criterion.requirement = requirement.id;
            requirements.push(requirement);
          }
          criteria.push(criterion);
        }
      }

      const { statement, fromTitle } = draftStatement(item);
      const codeFiles = [...(options.codeFiles?.[entry.id] ?? [])].sort();
      const notes: string[] = [];
      if (fromTitle) notes.push("statement drafted from the title: rewrite it as what the product does");
      if (criteria.length === 0) notes.push("no acceptance criteria in its history: add criteria");
      if (codeFiles.length === 0 && requirements.length === 0) {
        notes.push("no code or test evidence: confirm the capability still exists");
      }

      return {
        capability: entry.id,
        title: item.title,
        statement,
        criteria,
        requirements,
        sources: sources.map((s) => s.id),
        codeFiles,
        specReviewed: false as const,
        notes,
      };
    });
}
