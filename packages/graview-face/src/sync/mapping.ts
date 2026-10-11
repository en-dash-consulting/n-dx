/**
 * WHAT SYNCS, AND WHAT NEVER WILL. The requirements side of the graph — a
 * change's and a task's status, priority, title and tags — goes both ways;
 * rex is the system of record, and every push is a rex write under rex's
 * lock, validation and log. Every other kind is a read-only resource: the
 * engine lands what rex projects, sends nothing, and once it guards the
 * store an act on one is refused — and never offered — with the sentence
 * that names the tool that owns it.
 */
import type { ResourceMapping, SyncMapping } from "@graview/core/sync";

export const SYSTEM = "n-dx";
export const SYNCED_KINDS = ["change", "task"] as const;
export type SyncedKind = (typeof SYNCED_KINDS)[number];
/*
 * Not `plannedRelease`: rex exposes no MCP tool that sets it on a v1 tree
 * (edit_item takes title, description, priority, tags, run, blockedBy,
 * acceptanceCriteria, source). Add it here the day rex does.
 */
export const SYNC_FIELDS = ["status", "priority", "title", "tags"] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];
/** Our field that holds rex's version of a record: what a two-way sync agrees on. */
export const VERSION_FIELD = "lastModified";

export function isSyncedKind(kind: string): kind is SyncedKind {
  return (SYNCED_KINDS as readonly string[]).includes(kind);
}

/** Who owns each read-only kind, as the refusal says it. */
export const OWNERS: Readonly<Record<string, string>> = {
  area: "rex's product layer: on a v1 tree it is what the migration plan proposes, real once the PRD migrates; on v2, edit it with ndx rex product edit <node>",
  capability: "rex's product layer: on a v1 tree it is what the migration plan proposes, real once the PRD migrates; on v2, edit it with ndx rex product edit <node>",
  constraint: "rex's product layer: on a v1 tree it is what the migration plan proposes, real once the PRD migrates; on v2, edit it with ndx rex product edit <node>",
  release: "a field on each change (plannedRelease, shippedIn); rex stamps shippedIn from CI",
  zone: "sourcevision: re-run ndx analyze . to change the zones",
  component: "sourcevision: re-run ndx analyze . to change the catalogue",
  file: "the repository itself",
  run: "hench: a run record is history, written once by ndx work",
  commit: "git",
};

/** The sentence a read-only kind's resource declares: `engine.refuses(kind)` says it, and a guarded store refuses with it. */
export function because(kind: string): string {
  return `${kind} is not written from here: it belongs to ${OWNERS[kind] ?? "another tool"}.`;
}

/** The mapping over every kind the schema declares: two synced, the rest read-only. */
export function mapping(kinds: readonly string[]): SyncMapping {
  const synced: ResourceMapping[] = SYNCED_KINDS.map((kind) => ({
    kind,
    resource: kind,
    fields: Object.fromEntries(SYNC_FIELDS.map((f) => [f, f])),
    version: VERSION_FIELD,
  }));
  const owned: ResourceMapping[] = kinds.filter((kind) => !isSyncedKind(kind)).map((kind) => ({ kind, resource: kind, fields: {}, readonly: true, because: because(kind) }));
  return { system: SYSTEM, resources: [...synced, ...owned] };
}

/** An inbound change lands through the kind's derived edit act, like a person's edit would. */
export function applyInbound(call: { readonly localId: string; readonly kind: string; readonly fields: Readonly<Record<string, unknown>> }): { name: string; args: Record<string, unknown> } {
  return { name: `edit-${call.kind}`, args: { id: call.localId, ...call.fields } };
}
