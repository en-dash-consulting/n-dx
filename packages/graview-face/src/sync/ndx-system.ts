/**
 * THE n-dx REMOTE SYSTEM. Pull is a fresh projection: the door re-emits and
 * the snapshot is read back, every change and task carrying rex's
 * `lastModified` as its version (so our own write coming back is
 * recognizable). Push goes through rex's MCP tools behind the door —
 * `update_task_status` for a status, `edit_item` for the rest — after
 * reading the item, so only what differs is written, and an `append_log`
 * entry names the Graview principal that moved it.
 */
import type { RemoteAck, RemoteChange, RemoteSystem, RemoteWrite } from "@graview/core";
import { isSyncedKind, refusal, SYNC_FIELDS, SYSTEM } from "./mapping.js";

type Fetch = typeof fetch;

export interface NdxRemoteOptions {
  /** Who is moving things in this face, for the execution log. */
  readonly principal: string;
  readonly fetch?: Fetch;
  /** The door's base: "" in the page, a full origin in a test. */
  readonly base?: string;
  /** How long a pull's answer is reused, ms: the loop pulls once to pre-empt conflicts and once in the engine. */
  readonly pullTtlMs?: number;
}

interface SnapshotNode {
  id: string;
  kind: string;
  [field: string]: unknown;
}

interface Item {
  id: string;
  status?: string;
  priority?: string;
  title?: string;
  tags?: string[];
  lastModified?: string;
}

type Pulled = { readonly changes: readonly RemoteChange[]; readonly cursor: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The mapped fields of a snapshot node, as rex holds them. */
function fieldsOf(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of SYNC_FIELDS) if (node[field] !== undefined) out[field] = node[field];
  return out;
}

/** What the last re-emit said: when it failed, the snapshot a pull read is older than the tree. */
export interface EmitOutcome {
  readonly ok: boolean;
  readonly output: string;
}

export interface NdxRemote extends RemoteSystem {
  refuse(kind: string): string;
  /** Undefined until the first pull. */
  lastEmit(): EmitOutcome | undefined;
}

export function ndxRemote(options: NdxRemoteOptions): NdxRemote {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.base ?? "";
  const ttl = options.pullTtlMs ?? 1500;
  let memo: { at: number; result: Pulled } | undefined;
  let lastEmit: EmitOutcome | undefined;

  const JSON_HEADERS = { "content-type": "application/json" };
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const response = await doFetch(`${base}/ndx/mcp`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name, arguments: args }) });
    if (!response.ok) throw new Error(`rex is not reachable (${response.status})`);
    const body = (await response.json()) as { ok: boolean; result?: unknown; error?: string };
    if (!body.ok) throw new Error(body.error ?? `rex refused ${name}`);
    return body.result;
  };

  const item = async (id: string): Promise<Item> => {
    const got = (await call("get_item", { id })) as { item?: Item } & Item;
    return (got.item ?? got) as Item;
  };

  async function pullFresh(cursor?: string): Promise<Pulled> {
    // A fresh projection first; when the door cannot re-emit, the last emitted snapshot still answers, and the rail says it is stale.
    lastEmit = await doFetch(`${base}/ndx/emit`, { method: "POST", headers: JSON_HEADERS, body: "{}" })
      .then(async (r) => (r.ok ? ((await r.json()) as EmitOutcome) : { ok: false, output: `emit: ${r.status}` }))
      .catch((error: unknown) => ({ ok: false, output: error instanceof Error ? error.message : String(error) }));
    const response = await doFetch(`${base}/data/snapshot.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`snapshot: ${response.status}`);
    const snapshot = (await response.json()) as { nodes: SnapshotNode[] };
    const changes: RemoteChange[] = [];
    let newest = "";
    for (const node of snapshot.nodes) {
      if (!isSyncedKind(node.kind)) continue;
      const version = typeof node["lastModified"] === "string" ? node["lastModified"] : "";
      if (version > newest) newest = version;
      changes.push({ resource: node.kind, id: node.id, version, fields: fieldsOf(node) });
    }
    return { changes, cursor: `${snapshot.nodes.length}:${newest || cursor || ""}` };
  }

  async function one(write: RemoteWrite): Promise<RemoteAck> {
    if (!isSyncedKind(write.resource)) throw new Error(refusal(write.resource));
    if (write.deleted) throw new Error("the projection never deletes: remove an item with ndx prd remove");
    if (!write.id) throw new Error("a change or task is added in n-dx (ndx capture, ndx plan), not from this face");
    const before = await item(write.id);
    const wanted = write.fields ?? {};
    const wrote: string[] = [];
    if ("status" in wanted && !same(wanted["status"], before.status)) {
      await call("update_task_status", {
        id: write.id,
        status: wanted["status"],
        ...(wanted["status"] === "completed" ? { resolutionType: "acknowledgment", resolutionDetail: `marked done in Graview by ${options.principal}` } : {}),
      });
      wrote.push("status");
    }
    const edits: Record<string, unknown> = {};
    for (const field of ["priority", "title", "tags"] as const) {
      if (field in wanted && !same(wanted[field], before[field])) edits[field] = wanted[field];
    }
    if (Object.keys(edits).length > 0) {
      await call("edit_item", { id: write.id, ...edits });
      wrote.push(...Object.keys(edits));
    }
    if (wrote.length > 0) {
      await call("append_log", {
        event: "graview_sync",
        itemId: write.id,
        detail: `author=graview:${options.principal} wrote ${wrote.join(", ")} through ${SYSTEM}'s face`,
      });
      // A write changes what the next pull says; a memoized pull would call it an echo of nothing.
      memo = undefined;
    }
    const after = wrote.length > 0 ? await item(write.id) : before;
    return { localId: write.localId, id: write.id, version: after.lastModified ?? before.lastModified ?? "" };
  }

  return {
    name: SYSTEM,
    refuse: refusal,
    lastEmit: () => lastEmit,
    async pull(cursor) {
      if (memo && Date.now() - memo.at < ttl) return memo.result;
      const result = await pullFresh(cursor);
      memo = { at: Date.now(), result };
      return result;
    },
    async push(writes) {
      const acks: RemoteAck[] = [];
      for (const write of writes) {
        try {
          acks.push(await one(write));
        } catch (error) {
          acks.push({ localId: write.localId, id: write.id ?? "", version: "", error: error instanceof Error ? error.message : String(error) });
        }
      }
      return acks;
    },
  };
}
