/**
 * Apply a change's amendments to the product layer (rex schema v2).
 *
 * Deterministic and model-free: the result depends on the tree, the change and
 * the options alone. Pure: works on a copy of the tree and returns it, so a
 * refused apply leaves the caller's tree as it was. Writing the result is the
 * caller's job (`writePrdModel`, under the PRD lock). Wired to nothing yet,
 * like the other v2 modules.
 *
 * Per amendment, in the order the change lists them:
 *
 * - **added** creates a capability `under` an area or capability, titled
 *   `title`, with `proposed` as its statement and `criteria.add` as its
 *   criteria. With `type: "constraint"` it creates a constraint `under` any
 *   live product node instead, with `proposed` as its statement and the
 *   amendment's `requirements` and `appliesTo`; a constraint has no criteria.
 *   `target` names the new node: a display id (`A4.9`) becomes its
 *   `displayId` and the id comes from `newId`; anything else is the id.
 * - **modified** edits a live capability or constraint: `proposed`, when
 *   present, replaces the statement (it is the reviewed text by the time a
 *   change is applied); `criteria.remove`, `replace` and `add` edit criteria
 *   by id, in that order.
 * - **removed** retires the node: its status becomes `deleted`, the tombstone
 *   status every v2 rule skips. The file stays, with its History. The rules
 *   skip a tombstone's whole subtree, so a node with live descendants is
 *   refused unless the same change removes each of them too.
 *
 * Every amended node gets a History line in its body. Added and modified nodes
 * get `metAt` = {@link specHash} of the new spec (statement and criteria, never
 * the body) and lose `revisedAt`. The change gets `appliedAt`, the timestamp the
 * caller passes, and `appliedAmendsHash` ({@link amendsHash} of its amends), so
 * an amendment edited after apply is reported ({@link amendsEditedAfterApply}),
 * not silently ignored. Applying confirms the change's targets, so its
 * `needsPlacement` is cleared. A change that only touches nodes gets these
 * stamps and leaves the product layer untouched.
 *
 * A modified or removed amendment with `base` (the target's spec hash when it
 * was drafted) is refused when the target's spec before this change no longer
 * hashes to it, unless the caller passes `force`: another edit changed the
 * node since, and applying would silently revert it.
 *
 * Any problem refuses the whole apply with {@link ApplyAmendmentsError},
 * listing every problem found. Last, the v2 rules run on the result: an error
 * finding the input tree did not have refuses the apply too, with the findings.
 *
 * @module rex/core/apply-amendments
 */

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Requirement } from "../schema/v1.js";
import { RequirementSchema } from "../schema/validate.js";
import { isDisplayId, type Amendment, type Criterion } from "../schema/v2.js";
import { checkV2Rules, isAppliedChange, isOpenChange, specHash, type RuleFinding, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { slugifyTitle } from "../store/folder-tree-serializer.js";

export interface ApplyAmendmentsOptions {
  /** ISO timestamp stamped as the change's `appliedAt`. */
  appliedAt: string;
  /** Date written on History lines, and the reference time for the rules run on the result. */
  now: Date;
  /** Id for a node added under a display id. Default `randomUUID`. */
  newId?: () => string;
  /** Apply amendments whose `base` no longer matches their target's spec. */
  force?: boolean;
}

export interface AppliedAmendment {
  delta: Amendment["delta"];
  /** Id of the product node created, edited or retired. */
  nodeId: string;
  summary: string;
}

export interface ApplyAmendmentsResult {
  /** The tree with the amendments applied; the input tree is not modified. */
  tree: V2Tree;
  applied: AppliedAmendment[];
}

export class ApplyAmendmentsError extends Error {
  readonly problems: readonly string[];
  /** The rule findings the result introduced, when that is why apply refused. */
  readonly findings: readonly RuleFinding[];

  constructor(change: string, problems: readonly string[], findings: readonly RuleFinding[] = []) {
    super(`Cannot apply change ${change}: ${problems.join("; ")}`);
    this.name = "ApplyAmendmentsError";
    this.problems = problems;
    this.findings = findings;
  }
}

const HISTORY_HEADING = "## History";

/** Apply the amendments of the change `changeRef` (id, display id or alias) to `tree`. */
export function applyAmendments(tree: V2Tree, changeRef: string, options: ApplyAmendmentsOptions): ApplyAmendmentsResult {
  const next = structuredClone(tree);
  const change = resolve(next.changes, changeRef);
  if (!change || change.type !== "change") {
    throw new ApplyAmendmentsError(changeRef, [`no live change "${changeRef}"`]);
  }
  const label = change.displayId ?? change.id;
  if (!isOpenChange(change)) {
    const edited = editedAfterApply(change);
    const problems = isAppliedChange(change) ? [`already applied at ${change.appliedAt}`, ...(edited ? [edited] : [])] : [`it is ${change.status}`];
    throw new ApplyAmendmentsError(label, problems);
  }

  const amends = change.amends ?? [];
  const context: ApplyContext = { options, removing: removedIds(next.product, amends) };
  const date = options.now.toISOString().slice(0, 10);
  const problems: string[] = [];
  const applied: AppliedAmendment[] = [];
  for (const [i, amendment] of amends.entries()) {
    const fail = (message: string): void => {
      problems.push(`amendment ${i + 1} (${amendment.delta} ${amendment.target}): ${message}`);
    };
    if (amendment.base !== undefined && !checkBase(tree, next, amendment, options, fail)) continue;
    const node = APPLY[amendment.delta](next, amendment, context, fail);
    if (!node) continue;
    node.body = appendHistory(node.body, `- ${date} ${label} ${amendment.delta}: ${amendment.summary}`);
    applied.push({ delta: amendment.delta, nodeId: node.id, summary: amendment.summary });
  }
  if (problems.length > 0) throw new ApplyAmendmentsError(label, problems);

  change.appliedAt = options.appliedAt;
  change.appliedAmendsHash = amendsHash(amends);
  delete change.needsPlacement;

  const introduced = newErrors(tree, next, options.now);
  if (introduced.length > 0) {
    throw new ApplyAmendmentsError(label, introduced.map((f) => `the result breaks ${f.rule}: ${f.message}`), introduced);
  }
  return { tree: next, applied };
}

// ── Applied amends ───────────────────────────────────────────────

/**
 * The hash `appliedAmendsHash` records: SHA-256 hex of the amends as JSON with
 * object keys sorted, so key order never reads as an edit.
 */
export function amendsHash(amends: readonly Amendment[]): string {
  return createHash("sha256").update(canonicalJson(amends)).digest("hex");
}

export interface AmendsEditedAfterApply {
  /** Id of the applied change. */
  changeId: string;
  message: string;
}

/**
 * Applied changes whose amends no longer hash to their `appliedAmendsHash`:
 * an amendment edited or added after apply was never applied. A change applied
 * without the stamp cannot be checked and is not reported.
 */
export function amendsEditedAfterApply(tree: V2Tree): AmendsEditedAfterApply[] {
  const found: AmendsEditedAfterApply[] = [];
  const visit = (node: RuleNode): void => {
    const message = editedAfterApply(node);
    if (message) found.push({ changeId: node.id, message: `Change "${node.title}" ${message}` });
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of tree.changes) visit(node);
  return found;
}

function editedAfterApply(change: RuleNode): string | undefined {
  if (change.type !== "change" || !isAppliedChange(change) || !change.appliedAmendsHash) return undefined;
  if (amendsHash(change.amends ?? []) === change.appliedAmendsHash) return undefined;
  return `had its amends edited after it was applied (appliedAmendsHash ${change.appliedAmendsHash}); the edits were never applied, so draft a new change for them`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ── Stale amendments and the result's rules ──────────────────────

/**
 * Whether `amendment`'s `base` still matches its target's spec before this
 * change (in `before`), or `force` is set; reports through `fail` when not.
 */
function checkBase(before: V2Tree, after: V2Tree, amendment: Amendment, { force }: ApplyAmendmentsOptions, fail: (message: string) => void): boolean {
  if (amendment.delta === "added") {
    fail("an added amendment has no base; its target does not exist until apply");
    return false;
  }
  const target = resolve(before.product, amendment.target, { throughDeleted: true });
  if (!target) {
    // Missing from the layer altogether: the delta reports it. Present only in `after`: an earlier amendment added it.
    if (resolve(after.product, amendment.target, { throughDeleted: true })) fail(`base is set, but ${amendment.target} did not exist before this change`);
    return true;
  }
  const current = nodeSpecHash(target);
  if (current === amendment.base || force) return true;
  fail(`base ${amendment.base} no longer matches the target's spec ${current}; another edit changed it since this amendment was drafted (pass force to apply anyway)`);
  return false;
}

/** Error findings in `after` that `before` did not have, compared by rule, node and message. */
function newErrors(before: V2Tree, after: V2Tree, now: Date): RuleFinding[] {
  const key = (f: RuleFinding): string => `${f.rule}\0${f.nodeId}\0${f.message}`;
  const errors = (t: V2Tree): RuleFinding[] => checkV2Rules(t, { now }).filter((f) => f.severity === "error");
  const had = new Set(errors(before).map(key));
  return errors(after).filter((f) => !had.has(key(f)));
}

// ── Deltas ───────────────────────────────────────────────────────

interface ApplyContext {
  options: ApplyAmendmentsOptions;
  /** Ids of the live product nodes this change's removed amendments retire. */
  removing: ReadonlySet<string>;
}

/** Applies one amendment to the product layer and returns the node it acted on, or reports through `fail`. */
type DeltaApply = (
  tree: V2Tree,
  amendment: Amendment,
  context: ApplyContext,
  fail: (message: string) => void,
) => RuleNode | undefined;

const applyAdded: DeltaApply = ({ product, changes }, amendment, { options }, fail) => {
  // Retired nodes and changes count too: a reused id would share a state.yaml row with them.
  if (resolve([...product, ...changes], amendment.target, { includeDeleted: true })) {
    return void fail("a node in either layer, retired ones included, already has this id");
  }
  const type = amendment.type ?? "capability";
  const constraint = type === "constraint";
  if (!amendment.under) {
    return void fail(`an added ${type} needs under (its parent ${constraint ? "product node" : "area or capability"})`);
  }
  const parent = resolve(product, amendment.under);
  if (!parent || (!constraint && parent.type !== "area" && parent.type !== "capability")) {
    return void fail(`under "${amendment.under}" is not a live ${constraint ? "product node" : "area or capability"}`);
  }
  const title = amendment.title?.trim();
  if (!title) return void fail(`an added ${type} needs a title`);
  const fields = constraint ? constraintFields(amendment, fail) : capabilityFields(amendment, fail);
  if (!fields) return undefined;

  const display = isDisplayId(amendment.target);
  const id = display ? (options.newId ?? randomUUID)() : amendment.target;
  if (display && resolve([...product, ...changes], id, { includeDeleted: true })) {
    return void fail(`the new id ${id} is already taken`);
  }
  const node = {
    id,
    type,
    title,
    slug: freeSlug(title, id, parent.children ?? []),
    ...(display ? { displayId: amendment.target } : {}),
    ...(amendment.proposed !== undefined ? { statement: amendment.proposed } : {}),
    ...fields,
    status: "pending",
  } as RuleNode;
  stampMet(node);
  parent.children = [...(parent.children ?? []), node];
  return node;
};

/** A new capability's criteria, from `criteria.add`; undefined after reporting a problem. */
function capabilityFields(amendment: Amendment, fail: (message: string) => void): { criteria?: Criterion[] } | undefined {
  if (amendment.criteria?.replace?.length || amendment.criteria?.remove?.length) {
    return void fail("a new capability has no criteria to replace or remove; use criteria.add");
  }
  const criteria = amendment.criteria?.add ?? [];
  const duplicate = firstDuplicate(criteria.map((c) => c.id));
  if (duplicate) return void fail(`criterion ${duplicate} is added twice`);
  return criteria.length ? { criteria: criteria.map((c) => ({ ...c })) } : {};
}

const AppliesToSchema = z.union([z.literal("all"), z.array(z.string())]);

/** A new constraint's `requirements` and `appliesTo`, from the amendment; undefined after reporting a problem. */
function constraintFields(amendment: Amendment, fail: (message: string) => void): { requirements?: Requirement[]; appliesTo?: "all" | string[] } | undefined {
  const { criteria, requirements, appliesTo } = amendment;
  let ok = true;
  if (criteria?.add?.length || criteria?.replace?.length || criteria?.remove?.length) {
    ok = false;
    fail("a constraint has no criteria; state it in proposed and list its requirements");
  }
  const parsedRequirements = z.array(RequirementSchema).optional().safeParse(requirements);
  if (!parsedRequirements.success) {
    ok = false;
    fail("requirements must be a list of requirements");
  }
  const parsedAppliesTo = AppliesToSchema.optional().safeParse(appliesTo);
  if (!parsedAppliesTo.success) {
    ok = false;
    fail('appliesTo must be "all" or a list of product node references');
  }
  if (!ok) return undefined;
  return {
    ...(parsedRequirements.data?.length ? { requirements: parsedRequirements.data as Requirement[] } : {}),
    ...(parsedAppliesTo.data !== undefined ? { appliesTo: parsedAppliesTo.data } : {}),
  };
}

const applyModified: DeltaApply = ({ product }, amendment, _options, fail) => {
  const node = resolve(product, amendment.target);
  if (!node || (node.type !== "capability" && node.type !== "constraint")) {
    return void fail("not a live capability or constraint");
  }
  const delta = amendment.criteria;
  const hasCriteriaDelta = Boolean(delta?.add?.length || delta?.replace?.length || delta?.remove?.length);
  if (amendment.proposed === undefined && !hasCriteriaDelta) return void fail("nothing to modify: no proposed text or criteria delta");
  if (hasCriteriaDelta && node.type !== "capability") return void fail("a constraint has no criteria");

  let criteria: Criterion[] = node.type === "capability" ? [...(node.criteria ?? [])] : [];
  const has = (id: string): boolean => criteria.some((c) => c.id === id);
  let ok = true;
  const reject = (message: string): void => {
    ok = false;
    fail(message);
  };
  for (const id of delta?.remove ?? []) {
    if (!has(id)) reject(`criterion ${id} to remove does not exist`);
    criteria = criteria.filter((c) => c.id !== id);
  }
  for (const replacement of delta?.replace ?? []) {
    if (!has(replacement.id)) reject(`criterion ${replacement.id} to replace does not exist`);
    criteria = criteria.map((c) => (c.id === replacement.id ? { ...replacement } : c));
  }
  for (const added of delta?.add ?? []) {
    if (has(added.id)) reject(`criterion ${added.id} to add already exists`);
    else criteria.push({ ...added });
  }
  if (!ok) return undefined;

  if (amendment.proposed !== undefined) node.statement = amendment.proposed;
  if (node.type === "capability" && hasCriteriaDelta) {
    if (criteria.length) node.criteria = criteria;
    else delete node.criteria;
  }
  stampMet(node);
  return node;
};

const applyRemoved: DeltaApply = ({ product }, amendment, { removing }, fail) => {
  // An earlier amendment may have retired an ancestor of a target this change also removes.
  const node = resolve(product, amendment.target, { throughDeleted: true });
  if (!node) return void fail("not a live product node");
  const kept = liveDescendants(node).filter((d) => !removing.has(d.id));
  if (kept.length > 0) {
    return void fail(`live descendants ${kept.map((d) => d.displayId ?? d.id).join(", ")} would be hidden; remove them in this change too`);
  }
  node.status = "deleted";
  delete node.revisedAt;
  return node;
};

const APPLY: Readonly<Record<Amendment["delta"], DeltaApply>> = {
  added: applyAdded,
  modified: applyModified,
  removed: applyRemoved,
};

// ── Helpers ──────────────────────────────────────────────────────

/** Record that the node's current spec is met: `metAt` is its hash, and it is no longer revised. */
export function stampMet(node: RuleNode): void {
  if (node.type === "capability" || node.type === "constraint") node.metAt = nodeSpecHash(node);
  delete node.revisedAt;
}

/** {@link specHash} of the node's spec: a capability's statement and criteria, a constraint's statement, nothing for an area. */
export function nodeSpecHash(node: RuleNode): string {
  if (node.type === "capability") return specHash({ statement: node.statement, criteria: node.criteria });
  return specHash({ statement: node.type === "constraint" ? node.statement : undefined });
}

/**
 * The first live node in `nodes` (depth first) whose id, display id or alias is
 * `ref`. `includeDeleted` matches retired nodes too; `throughDeleted` still
 * skips them but searches their subtrees.
 */
export function resolve(
  nodes: readonly RuleNode[],
  ref: string,
  { includeDeleted = false, throughDeleted = false } = {},
): RuleNode | undefined {
  for (const node of nodes) {
    const retired = node.status === "deleted" && !includeDeleted;
    if (retired && !throughDeleted) continue;
    if (!retired && (node.id === ref || node.displayId === ref || node.aliases?.includes(ref))) return node;
    const hit = resolve(node.children ?? [], ref, { includeDeleted, throughDeleted });
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The slug for a new node: its title's slug, or that slug with the first six
 * id characters when a sibling holds it already (compared ignoring case, as
 * the writer does, which refuses any clash left). Existing siblings keep their
 * frozen slugs.
 */
export function freeSlug(title: string, id: string, siblings: readonly RuleNode[]): string {
  const taken = new Set(siblings.map((s) => s.slug.toLowerCase()));
  const base = slugifyTitle(title);
  if (!taken.has(base)) return base;
  return `${base}-${id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "item"}`;
}

/** Ids of the live product nodes the removed amendments in `amends` target, resolved before any is applied. */
function removedIds(product: readonly RuleNode[], amends: readonly Amendment[]): Set<string> {
  const ids = new Set<string>();
  for (const amendment of amends) {
    if (amendment.delta !== "removed") continue;
    const node = resolve(product, amendment.target, { throughDeleted: true });
    if (node) ids.add(node.id);
  }
  return ids;
}

/** Every live node below `node`; a retired child's subtree is already hidden. */
function liveDescendants(node: RuleNode): RuleNode[] {
  return (node.children ?? []).flatMap((child) => (child.status === "deleted" ? [] : [child, ...liveDescendants(child)]));
}

function firstDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

/** `body` with `line` appended to its History section, which is created at the end when missing. */
export function appendHistory(body: string | undefined, line: string): string {
  const text = (body ?? "").trimEnd();
  const lines = text === "" ? [] : text.split("\n");
  const start = lines.findIndex((l) => l.trim() === HISTORY_HEADING);
  if (start === -1) return [...(lines.length ? [...lines, ""] : []), HISTORY_HEADING, "", line].join("\n");
  let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  if (end === -1) end = lines.length;
  // Insert after the section's last non-blank line, keeping blank lines before the next heading.
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === "") at--;
  // A list line straight after prose would join its paragraph.
  const gap = at === start + 1 || !lines[at - 1].startsWith("- ") ? [""] : [];
  return [...lines.slice(0, at), ...gap, line, ...lines.slice(at)].join("\n");
}
