/**
 * WHAT SYNCS, AND WHAT NEVER WILL. The requirements side of the graph — a
 * change's and a task's status, priority, title and tags — goes both ways;
 * rex is the system of record, and every push is a rex write under rex's
 * lock, validation and log. Everything else is read-only here because
 * another tool owns it, and an act on it is refused naming that tool.
 */
import type { SyncMapping } from "@graview/core";

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

export function isSyncedKind(kind: string): kind is SyncedKind {
  return (SYNCED_KINDS as readonly string[]).includes(kind);
}

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

/** The sentence an act on a read-only kind gets back. */
export function refusal(kind: string): string {
  return `${kind} is not written from here: it belongs to ${OWNERS[kind] ?? "another tool"}.`;
}

export function mapping(): SyncMapping {
  return {
    system: SYSTEM,
    resources: SYNCED_KINDS.map((kind) => ({
      kind,
      resource: kind,
      fields: Object.fromEntries(SYNC_FIELDS.map((f) => [f, f])),
    })),
  };
}

/** An inbound change lands through the kind's derived edit act, like a person's edit would. */
export function applyInbound(call: { readonly localId: string; readonly kind: string; readonly fields: Readonly<Record<string, unknown>> }): { name: string; args: Record<string, unknown> } {
  return { name: `edit-${call.kind}`, args: { id: call.localId, ...call.fields } };
}
