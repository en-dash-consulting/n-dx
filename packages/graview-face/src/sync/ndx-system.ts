/**
 * THE n-dx REMOTE SYSTEM: Graview's `mcpRemote` over rex's MCP tools, reached
 * through the dev door (`doorClient` → `dev/ndx-door.ts`), which holds the
 * token. Pull is a fresh projection: the door re-emits, and the snapshot is
 * read back a kind at a time — only the changes and the tasks, by the byte
 * ranges its header gives — every record carrying rex's `lastModified` as its
 * version, so our own write coming back is recognizable. Push goes through
 * `update_task_status` for a status and `edit_item` for the rest, after
 * reading the item, so only what differs is written, and an `append_log`
 * entry names the Graview principal that moved it.
 */
import { fetchSnapshot } from "@graview/core/snapshot";
import { doorClient, mcpRemote, type RemoteChange, type RemoteSystem, type RemoteWrite, type ToolCall } from "@graview/core/sync";
import { isSyncedKind, SYNC_FIELDS, SYNCED_KINDS, SYSTEM, VERSION_FIELD } from "./mapping.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface NdxRemoteOptions {
  /** Who is moving things in this face, for the execution log. */
  readonly principal: string;
  readonly fetch?: Fetch;
  /** The door's base: "" in the page, a full origin in a test. */
  readonly base?: string;
}

interface Item {
  id: string;
  status?: string;
  priority?: string;
  title?: string;
  tags?: string[];
  lastModified?: string;
}

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
  /** Undefined until the first pull. */
  lastEmit(): EmitOutcome | undefined;
}

export function ndxRemote(options: NdxRemoteOptions): NdxRemote {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.base ?? "";
  const JSON_HEADERS = { "content-type": "application/json" };
  let lastEmit: EmitOutcome | undefined;

  const item = async (call: ToolCall, id: string): Promise<Item> => {
    const got = (await call("get_item", { id })) as { item?: Item } & Item;
    return (got.item ?? got) as Item;
  };

  async function pull(_call: ToolCall, cursor?: string): Promise<{ changes: RemoteChange[]; cursor: string }> {
    // A fresh projection first; when the door cannot re-emit, the last emitted snapshot still answers, and the rail says it is stale.
    lastEmit = await doFetch(`${base}/ndx/emit`, { method: "POST", headers: JSON_HEADERS, body: "{}" })
      .then(async (r) => (r.ok ? ((await r.json()) as EmitOutcome) : { ok: false, output: `emit: ${r.status}` }))
      .catch((error: unknown) => ({ ok: false, output: error instanceof Error ? error.message : String(error) }));
    const file = await fetchSnapshot(`${base}/data/snapshot.json`, { fetch: doFetch, kinds: [...SYNCED_KINDS], init: { cache: "no-store" } });
    const changes: RemoteChange[] = [];
    let newest = "";
    for (const node of file.snapshot.nodes as Array<Record<string, unknown> & { id: string; kind: string }>) {
      if (!isSyncedKind(node.kind)) continue;
      const version = typeof node[VERSION_FIELD] === "string" ? (node[VERSION_FIELD] as string) : "";
      if (version > newest) newest = version;
      changes.push({ resource: node.kind, id: node.id, version, fields: fieldsOf(node) });
    }
    return { changes, cursor: `${file.header.generatedAt ?? ""}:${newest || cursor || ""}` };
  }

  async function push(call: ToolCall, write: RemoteWrite): Promise<{ id: string; version: string }> {
    if (!isSyncedKind(write.resource)) throw new Error(`${write.resource} is not written from here.`);
    if (write.deleted) throw new Error("the projection never deletes: remove an item with ndx prd remove");
    if (!write.id) throw new Error("a change or task is added in n-dx (ndx capture, ndx plan), not from this face");
    const before = await item(call, write.id);
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
    }
    const after = wrote.length > 0 ? await item(call, write.id) : before;
    return { id: write.id, version: after.lastModified ?? before.lastModified ?? "" };
  }

  const remote = mcpRemote({ name: SYSTEM, call: doorClient({ path: "/ndx/mcp", base, fetch: doFetch }), pull, push });
  return { ...remote, lastEmit: () => lastEmit };
}
