/**
 * The item-edit card: what a `propose_item_edit` call proposes for an
 * existing item, read before the card is raised, the operator's edits of it,
 * and the write an approval makes.
 *
 * The card holds each changed field's value as read (`before`) and as
 * approval writes it (`after`); the operator may change `after` before
 * approving. Approval writes through rex's own `edit_item` handler, so the
 * item is edited exactly as the rex MCP tool edits it. A field whose stored
 * value moved since the card was raised is not overwritten: nothing is written.
 */

import { isDeepStrictEqual } from "node:util";
import { handleEditItem, resolveStore, type PRDItem } from "../rex-gateway.js";
import { refreshPRDCache } from "../prd-io.js";
import { errorMessage } from "../response-utils.js";
import { findItemByRef } from "../tracker/item-links.js";
import type { SidecarItemEdit, SidecarItemEditFields } from "../../shared/index.js";
import type { CarryOutResult } from "./carry-out.js";

/** The fields a card can change, in the order a card lists them. */
export const ITEM_EDIT_FIELDS = ["title", "description", "acceptanceCriteria", "tags", "priority"] as const;
type ItemEditField = (typeof ITEM_EDIT_FIELDS)[number];

const PRIORITIES = ["critical", "high", "medium", "low"] as const;

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

/** One proposed field's value as written, or why it cannot be. Lists drop blank entries; tags are trimmed and deduplicated. */
function fieldValue(field: ItemEditField, value: unknown): SidecarItemEditFields[ItemEditField] | { error: string } {
  switch (field) {
    case "title":
      return typeof value === "string" && value.trim() ? value.trim() : { error: "title must be a non-empty string" };
    case "description":
      return typeof value === "string" ? value : { error: "description must be a string" };
    case "acceptanceCriteria":
      return isStrings(value) ? value.map((c) => c.trim()).filter(Boolean) : { error: "acceptanceCriteria must be a list of strings" };
    case "tags":
      return isStrings(value) ? [...new Set(value.map((t) => t.trim()).filter(Boolean))] : { error: "tags must be a list of strings" };
    case "priority":
      return (PRIORITIES as readonly unknown[]).includes(value)
        ? value as SidecarItemEditFields["priority"]
        : { error: `priority must be one of ${PRIORITIES.join(", ")}` };
  }
}

/** The fields `source` names, each as written; a key outside {@link ITEM_EDIT_FIELDS} or a bad value is refused. */
function readFields(source: Record<string, unknown>, allowed: readonly ItemEditField[]): SidecarItemEditFields | string {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!(allowed as readonly string[]).includes(key)) return `${key} is not a field this card edits`;
    const read = fieldValue(key as ItemEditField, value);
    if (read && typeof read === "object" && "error" in read) return read.error;
    fields[key] = read;
  }
  return fields as SidecarItemEditFields;
}

/** The item's stored value of `field`, as a card compares it. */
function storedValue(item: PRDItem, field: ItemEditField): SidecarItemEditFields[ItemEditField] {
  switch (field) {
    case "title": return item.title;
    case "description": return item.description ?? "";
    case "acceptanceCriteria": return item.acceptanceCriteria ?? [];
    case "tags": return item.tags ?? [];
    case "priority": return item.priority;
  }
}

/** The proposed fields that differ from the item's stored values. */
function changedFields(item: PRDItem, proposed: SidecarItemEditFields): Pick<SidecarItemEdit, "before" | "after"> {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const field of ITEM_EDIT_FIELDS) {
    if (proposed[field] === undefined) continue;
    const stored = storedValue(item, field);
    if (isDeepStrictEqual(stored, proposed[field])) continue;
    before[field] = stored;
    after[field] = proposed[field];
  }
  return { before, after };
}

/** A `propose_item_edit` call read against the PRD for its card, or why no card can be raised. Writes nothing. */
export async function readItemEditCall(rexDir: string, input: Record<string, unknown>): Promise<SidecarItemEdit | string> {
  const { id, ...rest } = input;
  const itemId = typeof id === "string" ? id.trim() : "";
  if (!itemId) return "an edit names the item (id)";
  const proposed = readFields(rest, ITEM_EDIT_FIELDS);
  if (typeof proposed === "string") return proposed;
  if (Object.keys(proposed).length === 0) return `an edit gives at least one of ${ITEM_EDIT_FIELDS.join(", ")}`;
  const item = findItemByRef((await (await resolveStore(rexDir)).loadDocument()).items, itemId);
  if (!item) return `no item ${itemId}`;
  const { before, after } = changedFields(item, proposed);
  if (Object.keys(after).length === 0) return `${item.id} already has these values`;
  return { itemId: item.id, itemTitle: item.title, before, after };
}

/**
 * The card's edit with the operator's values for its fields, or why they are
 * refused. `edits` is an object of the card's own fields; a field it leaves
 * out keeps the agent's value.
 */
export function applyItemEditEdits(itemEdit: SidecarItemEdit, edits: unknown): SidecarItemEdit | string {
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) return "edits must be an object of the card's fields";
  const allowed = ITEM_EDIT_FIELDS.filter((field) => field in itemEdit.after);
  const read = readFields(edits as Record<string, unknown>, allowed);
  if (typeof read === "string") return read;
  return { ...itemEdit, after: { ...itemEdit.after, ...read } };
}

/** An approved item-edit card's write through rex's `edit_item`. Never throws. */
export async function writeItemEditCard(ctx: { rexDir: string; projectDir: string }, itemEdit: SidecarItemEdit): Promise<CarryOutResult> {
  try {
    const store = await resolveStore(ctx.rexDir);
    const item = findItemByRef((await store.loadDocument()).items, itemEdit.itemId);
    if (!item) return { ok: false, text: `Nothing was written: item ${itemEdit.itemId} is no longer in the PRD.` };
    const moved = ITEM_EDIT_FIELDS.filter((field) => field in itemEdit.before && !isDeepStrictEqual(storedValue(item, field), itemEdit.before[field]));
    if (moved.length > 0) {
      return { ok: false, text: `Nothing was written: ${moved.join(", ")} of ${item.id} changed since the card was raised.` };
    }
    const result = await handleEditItem(store, ctx.projectDir, { id: item.id, ...itemEdit.after });
    const text = result.content.map((part) => ("text" in part ? part.text : "")).join("\n");
    if (result.isError) return { ok: false, text: `Nothing was written: ${text}` };
    refreshPRDCache(ctx.rexDir, await store.loadDocument());
    return { ok: true, text: `Edited ${item.id} (${item.title}): ${Object.keys(itemEdit.after).join(", ")}.`, ids: [item.id] };
  } catch (err) {
    return { ok: false, text: `Nothing was written: ${errorMessage(err)}.` };
  }
}
