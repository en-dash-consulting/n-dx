/**
 * Migration plan, specs: a present-tense draft for each planned capability.
 *
 * Pure and deterministic, like the classification it reads
 * (`./migration-plan.ts`). This is the template draft: the text pass
 * (`./spec-pass.ts`) redrafts it with a model and falls back to it. For each
 * capability entry it drafts:
 *
 * - a **statement** in present tense: the first sentence of the v1 feature's
 *   description, unless that sentence describes work ("Add …", "This feature
 *   …", "will …"). Then there is no statement, and a note asks for one;
 * - EARS-style **criteria** from the acceptance criteria of the feature and of
 *   its applied history (the completed changes placed on it and their
 *   completed descendants), each citing the v1 item it came from. Unfinished
 *   work describes what is not built, and process criteria ("tests pass",
 *   "docs updated") describe how work is done, so neither contributes;
 * - an **automated requirement** for each criterion whose words match test
 *   files the way `verify_criteria` matches them (`core/keywords.ts`), held to a
 *   stricter score so one shared word does not link a test, and limited to the
 *   packages of the capability's code files when it has any.
 *
 * Code evidence comes from sourcevision, which rex may not import; the caller
 * passes it in per capability. A draft is unreviewed: applying the plan leaves
 * `reviewedHash` unset unless the caller lists the capability as reviewed with
 * this draft's `specHash` (`stampReview` in `./migration-plan-data.ts`).
 *
 * @module migrations/v1-to-v2/capability-spec
 */

import { posix } from "node:path";
import type { PRDItem, Requirement } from "../../schema/v1.js";
import type { Criterion } from "../../schema/v2.js";
import { extractKeywords, scoreMatch } from "../../core/keywords.js";
import { opensWithWorkVerb, type PlanEntry } from "./migration-plan.js";

export interface SpecCriterion extends Criterion {
  /** v1 id of the item the criterion came from; always one of the draft's `sources`. */
  source: string;
  /** Id of the automated requirement that checks it, when tests matched. */
  requirement?: string;
  /** The test files that requirement runs. */
  tests?: string[];
}

export interface CapabilitySpecDraft {
  /** v1 id of the capability entry. */
  capability: string;
  title: string;
  /** Absent when nothing in the sources states what the product does. */
  statement?: string;
  criteria: SpecCriterion[];
  requirements: Requirement[];
  /** v1 ids drawn on: the capability, then its applied history in tree order. */
  sources: string[];
  /** Code files sourcevision ties to the capability. */
  codeFiles: string[];
  /** Test files linked to at least one criterion, sorted. */
  tests: string[];
  /** Model that redrafted the template (`./spec-pass.ts`); absent on a template draft. */
  draftedBy?: string;
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

/** A criterion before ids are assigned: EARS text, the raw text it came from, its source item and linked tests. */
export interface CriterionCandidate {
  text: string;
  raw: string;
  source: string;
  tests: readonly string[];
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
const EARS_PREFIX = /^the system shall (?:ensure that )?/i;

/**
 * Verbs a criterion opens with when it states behaviour without a subject
 * ("removes dead exports"). Listed, not guessed: a plural noun ("logs are
 * kept") ends in -s too.
 */
const BEHAVIOUR_VERBS = new Set([
  "accept", "add", "allow", "apply", "ask", "block", "call", "check", "claim", "clear", "collect", "copy",
  "count", "create", "delete", "detect", "display", "drop", "emit", "ensure", "exclude", "exit", "expose",
  "fail", "fetch", "filter", "find", "flag", "generate", "handle", "hold", "include", "keep", "link",
  "list", "load", "lock", "log", "mark", "match", "merge", "move", "name", "offer", "parse", "pick",
  "place", "prefer", "preserve", "prevent", "print", "produce", "prompt", "read", "record", "refuse",
  "reject", "release", "remove", "rename", "render", "replace", "report", "resolve", "retry", "return",
  "reuse", "run", "save", "select", "send", "serve", "set", "show", "skip", "sort", "stamp", "start",
  "stop", "store", "support", "track", "update", "use", "validate", "verify", "warn", "write",
]);
/** Auxiliaries: as the second or third word, they make the opening words a subject ("Log entries are kept"). */
const AUXILIARIES = new Set([
  "is", "are", "was", "were", "be", "been", "has", "have", "had", "do", "does", "can", "cannot", "must",
  "should", "will", "shall", "may",
]);
/**
 * A second word that makes the first a subject, not a verb: an auxiliary, a
 * connective, relative pronoun or preposition ("Runs that …", "Runs from …"),
 * a participle ("Records written …") or a plural-subject verb ("Reads agree",
 * "Claims expire"). Behaviour verbs in base form count too ("Logs show …").
 */
const SUBJECT_FOLLOWERS = new Set([
  ...AUXILIARIES,
  "stay", "stays", "remain", "remains", "appear", "appears", "of", "and", "or",
  "that", "which", "who", "whose", "from", "with", "without", "in", "into", "on", "at", "by", "to", "for",
  "written", "taken", "given", "shown", "made", "seen", "held", "kept", "left", "sent", "found",
  "agree", "become", "carry", "change", "contain", "continue", "differ", "exist", "expire", "get", "go",
  "live", "need", "persist", "point", "succeed", "survive", "work",
]);

/**
 * Criteria about how work is done, not what the product does: tests pass, docs
 * updated, a changeset added, the build or typecheck clean, the PR reviewed.
 */
const PROCESS_CRITERIA: readonly RegExp[] = [
  /^(?:all |the |existing |new |relevant |affected |unit |e2e |integration |package |root )*(?:tests?|test suites?|suites?|specs?)(?: \w+)? (?:pass|passes|passing|still pass|are passing|are green|stay green|succeed)\b/i,
  /^(?:add|adds|write|writes|update|updates)(?: the)? (?:new |unit |e2e |integration |regression )?(?:tests?|specs?)\b/i,
  /^(?:new |unit |e2e |integration |regression )?(?:tests?|specs?) (?:are |is )?(?:added|written|updated)\b/i,
  /^(?:the )?(?:docs|documentation|readme|changelog|agents\.md|claude\.md)\b.*\b(?:updated?|added|written|mentions?|reflects?|documents?|describes?)\b/i,
  /^(?:add|adds|update|updates|write|writes)(?: the)? (?:docs|documentation|readme|changelog)\b/i,
  /^(?:a |the )?changesets? (?:is |are )?(?:added|included|written|present|exists?)\b/i,
  /^(?:add|adds|include|includes)(?: a| the)? changesets?\b/i,
  /^(?:pnpm )?(?:typecheck|tsc|lint|linting|build|ci)\b.*\b(?:pass|passes|succeeds?|clean|green)\b/i,
  /^no (?:type|typescript|lint|build) errors\b/i,
  /^(?:the )?(?:pr|pull request|code|change) (?:is )?(?:reviewed|approved|opened|merged)\b/i,
];

function lowerFirst(text: string): string {
  // Leave acronyms ("MCP", "PRD") as written.
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/** Criterion text without its trailing "(test)" marker or punctuation, in either order. */
export function criterionCore(text: string): string {
  return text.trim().replace(TRAILING_PUNCTUATION, "").replace(TEST_MARKER, "").replace(TRAILING_PUNCTUATION, "");
}

/** The criterion describes process (tests pass, docs updated, changeset added), not the product. */
export function isProcessCriterion(text: string): boolean {
  const core = criterionCore(text);
  const bare = core.replace(EARS_PREFIX, "");
  return PROCESS_CRITERIA.some((p) => p.test(core) || p.test(bare));
}

/**
 * The base form of a third-person behaviour verb ("removes" → "remove",
 * "applies" → "apply"), or undefined. A bare base form is not read as a verb:
 * opening a criterion it is a noun ("Run records include …", "Log files …")
 * or an instruction, not behaviour.
 */
function behaviourVerb(word: string): string | undefined {
  const w = word.toLowerCase();
  if (!w.endsWith("s")) return undefined;
  const forms = [w.replace(/ies$/, "y"), w.replace(/es$/, ""), w.replace(/s$/, "")];
  return forms.find((f) => f !== w && BEHAVIOUR_VERBS.has(f));
}

/** One criterion in EARS form: EARS-shaped text is kept, a verb-led one gets "The system shall", the rest the ubiquitous form. */
export function toEars(text: string): string {
  const core = criterionCore(text);
  if (EARS_OPENERS.test(core) || /\bshall\b/i.test(core)) return `${core}.`;
  const [first = "", second = "", third = ""] = core.split(/\s+/, 3);
  const verb = behaviourVerb(first);
  const next = second.toLowerCase();
  // Capitalised or not ("Removes dead exports", "removes dead exports"): the words after it decide.
  const subject = SUBJECT_FOLLOWERS.has(next) || BEHAVIOUR_VERBS.has(next) || AUXILIARIES.has(third.toLowerCase());
  if (verb && /^[A-Za-z]+$/.test(first) && !subject) {
    return `The system shall ${verb}${core.slice(first.length)}.`;
  }
  return `The system shall ensure that ${lowerFirst(core)}.`;
}

/** A sentence end, not the dot of an abbreviation ("e.g.", "i.e.", "etc.", "vs."). */
const SENTENCE_BREAK = /(?<!\b(?:e\.g|i\.e|etc|vs)\.)(?<=[.!?])\s+|\n/;
/** Review metadata or a reference, not a description of the product ("**Severity:** …", "Verdict: …", "GitHub #368."). */
const NOT_A_STATEMENT = /^(?:[#*>|`\-[]|(?:severity|verdict|priority|status|github|issue|pr)\b)/i;
/** Wording that describes work or a wish rather than what the product does now. */
const WORK_SHAPED = /\b(?:(?:this|the) (?:feature|task|change|epic|pr|item|ticket|story)\b|will|should|needs? to|todo|tbd)\b|^(?:currently|today|right now|we|i|users? (?:can(?:not|'t)|need|want))\b/i;
const MIN_STATEMENT_WORDS = 4;

function firstSentence(text: string | undefined): string | undefined {
  const sentence = text?.trim().split(SENTENCE_BREAK)[0]?.trim();
  return sentence ? sentence : undefined;
}

/** The sentence states, in present tense, what the product does: not metadata, work or a wish. */
export function isPresentTenseStatement(sentence: string | undefined): sentence is string {
  if (sentence === undefined || NOT_A_STATEMENT.test(sentence) || opensWithWorkVerb(sentence)) return false;
  if (WORK_SHAPED.test(sentence)) return false;
  return sentence.split(/\s+/).length >= MIN_STATEMENT_WORDS;
}

/** A statement ending in sentence punctuation. */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function draftStatement(item: PRDItem): string | undefined {
  const sentence = firstSentence(item.description);
  return isPresentTenseStatement(sentence) ? asSentence(sentence) : undefined;
}

/** Path prefix of the package or top-level directory a file lives in. */
function packageRoot(file: string): string {
  const parts = file.split("/");
  return parts[0] === "packages" && parts.length > 2 ? `packages/${parts[1]}/` : `${parts[0]}/`;
}

/**
 * Test files in the packages of the code files, plus the repository-level
 * tests outside `packages/` (where a package with no suite of its own, such
 * as `packages/core`, keeps its tests); every test file when there are no
 * code files.
 */
export function scopedTestFiles(testFiles: readonly string[], codeFiles: readonly string[]): readonly string[] {
  if (codeFiles.length === 0) return testFiles;
  const roots = new Set(codeFiles.map(packageRoot));
  return testFiles.filter((f) => !f.startsWith("packages/") || roots.has(packageRoot(f)));
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

/**
 * Criteria and requirements from candidates in order: process criteria and
 * repeats dropped, ids `c1…cn`, a requirement for each criterion with tests.
 */
export function assembleCriteria(
  capability: string,
  candidates: readonly CriterionCandidate[],
  testCommand: string | undefined,
): { criteria: SpecCriterion[]; requirements: Requirement[] } {
  const criteria: SpecCriterion[] = [];
  const requirements: Requirement[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (isProcessCriterion(candidate.raw) || isProcessCriterion(candidate.text)) continue;
    const key = candidate.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const criterion: SpecCriterion = { id: `c${criteria.length + 1}`, text: candidate.text, source: candidate.source };
    if (candidate.tests.length > 0) {
      const tests = [...candidate.tests].sort();
      const requirement: Requirement = {
        id: `${capability}:${criterion.id}`,
        title: criterionCore(candidate.raw),
        description: `Linked to: ${tests.join(", ")}`,
        category: "technical",
        validationType: "automated",
        acceptanceCriteria: [candidate.text],
        ...(testCommand ? { validationCommand: `${testCommand} ${tests.join(" ")}` } : {}),
      };
      criterion.requirement = requirement.id;
      criterion.tests = tests;
      requirements.push(requirement);
    }
    criteria.push(criterion);
  }
  return { criteria, requirements };
}

/** The tests linked to any criterion, sorted and unique. */
export function linkedTestsOf(criteria: readonly SpecCriterion[]): string[] {
  return [...new Set(criteria.flatMap((c) => c.tests ?? []))].sort();
}

/** Notes about missing evidence: no criteria, or neither code nor tests. */
export function evidenceNotes(spec: Pick<CapabilitySpecDraft, "criteria" | "codeFiles" | "requirements">): string[] {
  const notes: string[] = [];
  if (spec.criteria.length === 0) notes.push("no acceptance criteria in its history: add criteria");
  if (spec.codeFiles.length === 0 && spec.requirements.length === 0) {
    notes.push("no code or test evidence: confirm the capability still exists");
  }
  return notes;
}

export const NO_STATEMENT_NOTE = "no present-tense statement in its description: write what the product does";

/** Every item in the tree by id. */
export function indexItems(items: readonly PRDItem[], into = new Map<string, PRDItem>()): Map<string, PRDItem> {
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

/**
 * The capability's item, then its applied history in plan order: the only
 * items a spec may draw on. The history is every applied change the entries
 * place on it, whether the rules or a model pass placed it.
 */
export function specSources(entries: readonly PlanEntry[], capability: string, byId: ReadonlyMap<string, PRDItem>): PRDItem[] {
  const item = byId.get(capability);
  if (!item) throw new Error(`capability ${capability} is not in the v1 tree the plan was built from`);
  const sources: PRDItem[] = [item];
  for (const change of entries) {
    if (change.target !== "change" || change.placement !== capability || !change.applied) continue;
    const changeItem = byId.get(change.id);
    if (changeItem) completedHistory(changeItem, sources);
  }
  return sources;
}

/** Draft a present-tense spec for every capability among the plan's entries, in plan order. */
export function draftCapabilitySpecs(
  plan: { readonly entries: readonly PlanEntry[] },
  items: readonly PRDItem[],
  options: SpecDraftOptions,
): CapabilitySpecDraft[] {
  const byId = indexItems(items);
  const minScore = options.minTestScore ?? DEFAULT_MIN_TEST_SCORE;

  return plan.entries
    .filter((e) => e.target === "capability")
    .map((entry) => {
      const sources = specSources(plan.entries, entry.id, byId);
      const item = sources[0]!;
      const codeFiles = [...(options.codeFiles?.[entry.id] ?? [])].sort();
      const testFiles = scopedTestFiles(options.testFiles, codeFiles);

      const candidates: CriterionCandidate[] = sources.flatMap((source) =>
        (source.acceptanceCriteria ?? []).map((raw) => ({
          text: toEars(raw),
          raw,
          source: source.id,
          tests: linkedTests(raw, testFiles, minScore),
        })),
      );
      const { criteria, requirements } = assembleCriteria(entry.id, candidates, options.testCommand);
      const statement = draftStatement(item);

      const draft: CapabilitySpecDraft = {
        capability: entry.id,
        title: item.title,
        ...(statement !== undefined ? { statement } : {}),
        criteria,
        requirements,
        sources: sources.map((s) => s.id),
        codeFiles,
        tests: linkedTestsOf(criteria),
        notes: [],
      };
      draft.notes = [...(statement === undefined ? [NO_STATEMENT_NOTE] : []), ...evidenceNotes(draft)];
      return draft;
    });
}
