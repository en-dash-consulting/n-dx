/**
 * THE LOOP. Graview's SyncEngine over this face's store and the n-dx remote:
 * inbound first, then what changed here. Every change and task is linked at
 * the version it was projected with (`version: "lastModified"` in the
 * mapping), so the first run pushes nothing it did not have to. Rex stamps
 * `lastModified` on every write, so an item it has not written since the
 * stamp existed carries none: that record is linked at no version
 * (`unversionedLinks`), where the engine would take it for a record made
 * here and ask rex to create it. Its first rex write is news; its first edit
 * here is a push.
 *
 * A WRITE REX REFUSES IS UNDONE HERE. The engine drops a refused write and
 * leaves the record as edited, but the link still holds what rex and the
 * face last agreed, and rex's version has not moved, so no pull would ever
 * correct it: the record would show a value rex does not hold and be
 * re-sent, and refused, every run. After each run the refused records take
 * the link's fields back through the inbound act, authored by the system,
 * and the rail says the refusal once.
 *
 * RULE: rex wins. The engine's policy is `conflicts: "theirs"`: a field
 * edited on both sides since they last agreed takes rex's value through the
 * ordinary inbound act (so it lands in the log, authored by the system), and
 * the report says each one it settled. What rex kept is said in the rail,
 * never hidden. The engine guards the store while the loop runs, so an act
 * on a kind another tool owns is refused — and not offered — in the sentence
 * the mapping declares.
 */
import { SyncEngine, systemAuthor, type RemoteLink, type SettledConflict, type SyncReport } from "@graview/core/sync";
import { PermissionDeniedError, type AnySchema, type Store } from "@graview/core";
import { applyInbound, because, isSyncedKind, linkBecause, mapping, SYNC_FIELDS, SYSTEM, VERSION_FIELD } from "./mapping.js";
import { ndxRemote, type EmitOutcome, type NdxRemote, type NdxRemoteOptions } from "./ndx-system.js";

export interface SyncStatus {
  readonly running: boolean;
  readonly lastRun?: Date;
  readonly report?: SyncReport;
  /** Conflicts the last run settled to rex's value. */
  readonly resolved: readonly SettledConflict[];
  /** Set when the last pull could not re-emit: what it read is older than the tree. */
  readonly stale?: string;
  readonly error?: string;
}

export interface SyncHandle {
  readonly runNow: () => Promise<SyncStatus>;
  readonly stop: () => void;
  readonly status: () => SyncStatus;
  readonly subscribe: (listener: (status: SyncStatus) => void) => () => void;
}

export interface SyncOptions extends NdxRemoteOptions {
  readonly store: Store<AnySchema>;
}

export interface StartSyncOptions extends SyncOptions {
  /** Pull interval, ms. */
  readonly every?: number;
  /** How long after a local edit to push, ms. */
  readonly settle?: number;
}

export interface Sync {
  readonly engine: SyncEngine<AnySchema>;
  readonly remote: NdxRemote;
  /** One pass of the engine: inbound, conflicts settled to rex, then what changed here. */
  run(): Promise<{ report: SyncReport; resolved: readonly SettledConflict[]; emit?: EmitOutcome }>;
  /** Hold the store to what rex takes: the engine's guard, and no link made or taken away on a synced record. Returns the way back. */
  guard(): () => void;
}

/** A derived relation act on a synced kind: `connect-change-touches`, `disconnect-task-blocked-by`. */
const SYNCED_LINK_ACT = /^(connect|disconnect)-(change|task)-/;

type Planned = { readonly ops: readonly { readonly author: { kind: string; id: string }; readonly mutation?: { name: string }; readonly primitives: readonly Record<string, unknown>[] }[] };

/**
 * NO LINK IS MADE HERE. The engine pushes a change's and a task's fields, and
 * nothing at all for the read-only kinds; a link added or taken away on any
 * record would stay in the face, never reach rex, sourcevision, hench or git,
 * and never be put back. Graview's own guard holds a read-only kind's fields
 * but judges an edge only where the mapping lists `edges`, so this guard
 * refuses every link when it is tried, with the owner's sentence, and hides
 * the derived `connect-`/`disconnect-` acts on change and task (Graview
 * already hides them on the kinds it owns). Rex's own inbound changes pass,
 * and so does a record's removal, which takes its links with it.
 */
export function holdSyncedLinks(store: Store<AnySchema>): () => void {
  const held = store as unknown as Record<string, unknown>;
  const names = ["applyAll", "undo", "permits", "permittedMutations"] as const;
  const was = names.map((name) => [name, held[name], Object.prototype.hasOwnProperty.call(store, name)] as const);
  const applyAll = store.applyAll;
  const undo = store.undo;
  const permits = store.permits;
  const permittedMutations = store.permittedMutations;
  const refuse = (planned: Planned): void => {
    for (const op of planned.ops) {
      if (op.author.kind === "system" && op.author.id === SYSTEM) continue;
      const removed = new Set(op.primitives.filter((p) => p["op"] === "remove-node").map((p) => (p["node"] as { id: string }).id));
      for (const primitive of op.primitives) {
        if (primitive["op"] !== "add-edge" && primitive["op"] !== "remove-edge") continue;
        const edge = primitive["edge"] as { kind: string; from: string; to: string };
        if (primitive["op"] === "remove-edge" && (removed.has(edge.from) || removed.has(edge.to))) continue;
        const kind = String((store.graph.getNode(edge.from) as unknown as Record<string, unknown> | undefined)?.["kind"] ?? "");
        if (!kind) continue;
        // Graview's own guard holds a read-only kind's fields, not its links (it judges an edge only where a
        // mapping lists `edges`), so a link on a zone or a run would land here and never reach its owner either.
        const message = isSyncedKind(kind) ? linkBecause(kind, edge.kind) : because(kind);
        throw new PermissionDeniedError({ mutation: op.mutation?.name ?? "", message, wouldNeed: [] } as never);
      }
    }
  };
  type ApplyOptions = { admit?: (planned: never) => void } & Record<string, unknown>;
  const admitted = (options: ApplyOptions = {}): ApplyOptions => ({
    ...options,
    admit: (planned: never) => {
      refuse(planned as Planned);
      options.admit?.(planned);
    },
  });
  held["applyAll"] = (calls: unknown, options?: ApplyOptions) => (applyAll as (c: unknown, o: ApplyOptions) => unknown).call(store, calls, admitted(options));
  held["undo"] = (batchIds: unknown, options?: ApplyOptions) => (undo as (b: unknown, o: ApplyOptions) => unknown).call(store, batchIds, admitted(options));
  held["permits"] = (call: { name: string }, principal: { kind?: string; id?: string } | undefined) => {
    const verdict = (permits as (c: unknown, p: unknown) => { ok: boolean }).call(store, call, principal);
    const rex = principal?.kind === "system" && principal.id === SYSTEM;
    const link = SYNCED_LINK_ACT.exec(call.name);
    if (!verdict.ok || rex || !link) return verdict;
    // The act names the relation in kebab case (`connect-task-blocked-by`); the sentence names it as the declaration does.
    const relation = call.name.slice(link[0].length).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    return { ok: false, refusal: { mutation: call.name, message: linkBecause(link[2]!, relation), wouldNeed: [] } };
  };
  held["permittedMutations"] = (principal: unknown) =>
    (permittedMutations as (p: unknown) => readonly { name: string }[]).call(store, principal).filter((mutation) => !SYNCED_LINK_ACT.test(mutation.name));
  return () => {
    for (const [name, value, own] of was) {
      if (own) held[name] = value;
      else delete held[name];
    }
  };
}

/** A link at no version for every synced record that carries none: projected by rex, agreed at nothing, never ours to create. */
export function unversionedLinks(store: Store<AnySchema>): Record<string, RemoteLink> {
  const links: Record<string, RemoteLink> = {};
  for (const node of store.graph.allNodes() as unknown as Array<Record<string, unknown> & { id: string; kind: string }>) {
    if (!isSyncedKind(node.kind) || typeof node[VERSION_FIELD] === "string") continue;
    const fields: Record<string, unknown> = {};
    for (const field of SYNC_FIELDS) fields[field] = node[field];
    links[node.id] = { resource: node.kind, id: node.id, version: "", fields };
  }
  return links;
}

/** Put rex's last agreed values back on every record whose write rex refused. */
export function restoreRefused(store: Store<AnySchema>, report: SyncReport): void {
  for (const { localId } of report.refused) {
    const link = report.state.links[localId];
    const node = store.graph.getNode(localId) as unknown as Record<string, unknown> | undefined;
    if (!link || !node || !isSyncedKind(String(node["kind"]))) continue;
    const fields: Record<string, unknown> = {};
    for (const field of SYNC_FIELDS) {
      const agreed = link.fields[field];
      if (agreed !== undefined && JSON.stringify(agreed) !== JSON.stringify(node[field] ?? null)) fields[field] = agreed;
    }
    if (Object.keys(fields).length === 0) continue;
    store.apply(applyInbound({ localId, kind: String(node["kind"]), fields }), { author: systemAuthor(SYSTEM), intent: `${SYSTEM} refused: ${Object.keys(fields).join(", ")}` });
  }
}

export function createSync(options: SyncOptions): Sync {
  const remote = ndxRemote(options);
  const kinds = options.store.schema.kinds as readonly string[];
  const engine = new SyncEngine<AnySchema>({ store: options.store, mapping: mapping(kinds), remote, applyInbound, conflicts: "theirs" }, { links: unversionedLinks(options.store), outbox: [] });
  return {
    engine,
    remote,
    async run() {
      const report = await engine.run();
      restoreRefused(options.store, report);
      const emit = remote.lastEmit();
      return { report, resolved: report.resolved, ...(emit ? { emit } : {}) };
    },
    guard() {
      const engineGuard = engine.guard();
      const linkGuard = holdSyncedLinks(options.store);
      return () => {
        linkGuard();
        engineGuard();
      };
    },
  };
}

export function startSync(options: StartSyncOptions): SyncHandle {
  const sync = createSync(options);
  const release = sync.guard();
  const listeners = new Set<(status: SyncStatus) => void>();
  let status: SyncStatus = { running: false, resolved: [] };
  let inFlight: Promise<SyncStatus> | undefined;
  // An edit made while a run is in flight runs again right after, not at the next interval.
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const tell = (next: SyncStatus) => {
    status = next;
    for (const listener of listeners) listener(status);
  };

  const runNow = (): Promise<SyncStatus> => {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    tell({ ...status, running: true, error: undefined });
    inFlight = (async () => {
      try {
        const { report, resolved, emit } = await sync.run();
        tell({ running: false, lastRun: new Date(), report, resolved, ...(emit && !emit.ok ? { stale: emit.output.trim().split("\n").pop() ?? "re-emit failed" } : {}) });
      } catch (error) {
        tell({ ...status, running: false, lastRun: new Date(), error: error instanceof Error ? error.message : String(error) });
      } finally {
        inFlight = undefined;
      }
      if (again && !stopped) {
        again = false;
        return runNow();
      }
      return status;
    })();
    return inFlight;
  };

  const settle = options.settle ?? 1500;
  const unsubscribe = options.store.subscribe((_diff, ops) => {
    if (stopped) return;
    // Our own inbound ops come back through here too; only a person's or an agent's edit schedules a push.
    if (ops.every((op) => op.author.kind === "system")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runNow(), settle);
  });
  const interval = setInterval(() => void runNow(), options.every ?? 30_000);
  void runNow();

  return {
    runNow,
    status: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    stop: () => {
      stopped = true;
      unsubscribe();
      release();
      if (timer) clearTimeout(timer);
      clearInterval(interval);
    },
  };
}
