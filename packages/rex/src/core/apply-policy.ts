/**
 * When a change's amendments are applied to the product layer (`rex.applyOn`).
 *
 * - **complete** (default): a change applies when it completes on its branch.
 * - **review**: a completed change waits for a steward to apply it.
 * - **release**: completed changes apply when a release is stamped.
 *
 * Callers report the moment through an {@link ApplyTrigger}; a steward's
 * explicit apply runs under every mode. Until a change is applied it stays
 * open (`isOpenChange`), so the capabilities it amends keep reading changing.
 *
 * The decision is pure. Only {@link loadApplyOn} touches disk, through
 * `loadProjectOverrides`.
 *
 * @module core/apply-policy
 */

import { loadProjectOverrides } from "@n-dx/llm-client";
import { isOpenChange, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { applyAmendments, resolve, type ApplyAmendmentsOptions, type ApplyAmendmentsResult } from "./apply-amendments.js";

export type ApplyOn = "complete" | "review" | "release";

export const DEFAULT_APPLY_ON: ApplyOn = "complete";

const APPLY_ON: readonly ApplyOn[] = ["complete", "review", "release"];

/**
 * The moment a caller asks to apply: a change completed on its branch
 * (`complete`), a steward applies it explicitly (`steward`), or a release is
 * stamped (`release`).
 */
export type ApplyTrigger = "complete" | "steward" | "release";

/** Section of `.n-dx.json` that holds rex settings (`rex.applyOn`). */
const REX_CONFIG_KEY = "rex";

/** Read `rex.applyOn` from a parsed `rex` config section; an invalid value falls back to the default with a warning. */
export function parseApplyOn(rexSection: Record<string, unknown>): { applyOn: ApplyOn; warnings: string[] } {
  const value = rexSection.applyOn;
  if (value === undefined) return { applyOn: DEFAULT_APPLY_ON, warnings: [] };
  if (typeof value === "string" && (APPLY_ON as readonly string[]).includes(value)) return { applyOn: value as ApplyOn, warnings: [] };
  return {
    applyOn: DEFAULT_APPLY_ON,
    warnings: [`rex.applyOn: ${JSON.stringify(value)} is not one of ${APPLY_ON.join(", ")}; using "${DEFAULT_APPLY_ON}"`],
  };
}

/** Load `rex.applyOn` from the `.n-dx.json` next to `rexDir` (the `.rex` directory). */
export async function loadApplyOn(rexDir: string): Promise<{ applyOn: ApplyOn; warnings: string[] }> {
  return parseApplyOn(await loadProjectOverrides(rexDir, REX_CONFIG_KEY));
}

/** Whether `trigger` applies a completed change under `applyOn`. A steward's explicit apply always does. */
export function appliesOn(applyOn: ApplyOn, trigger: ApplyTrigger): boolean {
  return trigger === "steward" || trigger === applyOn;
}

export type ApplyOnTriggerResult =
  | { applied: true; result: ApplyAmendmentsResult }
  | { applied: false; reason: string };

export interface ApplyOnTriggerOptions extends ApplyAmendmentsOptions {
  applyOn: ApplyOn;
}

/**
 * Apply the change `changeRef` if `trigger` applies it under `applyOn`.
 * `complete` and `release` act on completed changes only; a steward may apply
 * any open change. A deferred change is returned unapplied with the reason and
 * the tree untouched; a refused apply throws `ApplyAmendmentsError` as
 * {@link applyAmendments} does.
 */
export function applyOnTrigger(tree: V2Tree, changeRef: string, trigger: ApplyTrigger, options: ApplyOnTriggerOptions): ApplyOnTriggerResult {
  const { applyOn, ...applyOptions } = options;
  if (!appliesOn(applyOn, trigger)) {
    return { applied: false, reason: `rex.applyOn is "${applyOn}", so ${TRIGGER_LABEL[trigger]} does not apply the change` };
  }
  const change = resolve(tree.changes, changeRef);
  if (trigger !== "steward" && change?.type === "change" && change.status !== "completed") {
    return { applied: false, reason: `change ${change.displayId ?? change.id} is ${change.status ?? "pending"}, not completed` };
  }
  return { applied: true, result: applyAmendments(tree, changeRef, applyOptions) };
}

const TRIGGER_LABEL: Readonly<Record<ApplyTrigger, string>> = {
  complete: "completing it",
  steward: "a steward",
  release: "stamping a release",
};

/** Completed changes not yet applied, depth first: what a steward reviews, or a release stamp applies. */
export function changesAwaitingApply(tree: V2Tree): RuleNode[] {
  const found: RuleNode[] = [];
  const visit = (node: RuleNode): void => {
    if (node.status === "deleted") return;
    if (node.type === "change" && node.status === "completed" && isOpenChange(node)) found.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of tree.changes) visit(node);
  return found;
}
