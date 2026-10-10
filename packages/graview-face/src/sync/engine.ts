/**
 * THE LOOP. Graview's SyncEngine over this face's store and the n-dx remote:
 * inbound first, then what changed here. The links are seeded from the
 * snapshot the store was opened with, so the first run pushes nothing it did
 * not have to.
 *
 * RULE: rex wins. The engine reports a field edited on both sides as a
 * conflict, but its one pass pushes our value in the same breath — which
 * would overwrite rex with stale state before anyone could resolve it. So
 * every run pre-empts: it pulls first, finds each field both sides changed
 * since they last agreed, takes rex's value through the ordinary inbound
 * act (so it lands in the log, authored by the system), and only then lets
 * the engine run. What rex kept is said in the rail, never hidden.
 */
import { SyncEngine, type AnySchema, type RemoteLink, type RemoteSystem, type Store, type SyncConflict, type SyncReport, type SyncState } from "@graview/core";
import { applyInbound, isSyncedKind, mapping, SYNC_FIELDS } from "./mapping.js";
import { ndxRemote, type NdxRemoteOptions } from "./ndx-system.js";

export interface SyncStatus {
  readonly running: boolean;
  readonly lastRun?: Date;
  readonly report?: SyncReport;
  /** Conflicts the last run resolved to rex's value. */
  readonly resolved: readonly SyncConflict[];
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

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Every synced record the store holds, linked at the version it was projected with. */
export function seedLinks(store: Store<AnySchema>): Record<string, RemoteLink> {
  const links: Record<string, RemoteLink> = {};
  for (const node of store.graph.allNodes() as unknown as Array<Record<string, unknown> & { id: string; kind: string }>) {
    if (!isSyncedKind(node.kind)) continue;
    const fields: Record<string, unknown> = {};
    for (const field of SYNC_FIELDS) fields[field] = node[field];
    links[node.id] = { resource: node.kind, id: node.id, version: typeof node["lastModified"] === "string" ? node["lastModified"] : "", fields };
  }
  return links;
}

export interface Sync {
  readonly engine: SyncEngine<AnySchema>;
  readonly remote: RemoteSystem;
  /** One pass: pre-empt conflicts to rex's value, then the engine's own run. */
  run(): Promise<{ report: SyncReport; resolved: readonly SyncConflict[] }>;
}

export function createSync(options: SyncOptions): Sync {
  const remote = ndxRemote(options);
  const engine = new SyncEngine<AnySchema>({ store: options.store, mapping: mapping(), remote, applyInbound }, { links: seedLinks(options.store), outbox: [] });
  let state: SyncState | undefined;

  const preempt = async (): Promise<SyncConflict[]> => {
    const links = state?.links ?? seedLinks(options.store);
    const { changes } = await remote.pull(state?.cursor);
    const resolved: SyncConflict[] = [];
    for (const change of changes) {
      const link = links[change.id];
      if (!link || link.version === change.version || !change.fields) continue;
      const node = options.store.graph.getNode(change.id) as Record<string, unknown> | undefined;
      if (!node) continue;
      for (const field of SYNC_FIELDS) {
        if (!(field in change.fields)) continue;
        const theirs = change.fields[field];
        const ours = node[field];
        const base = link.fields[field];
        if (same(theirs, base) || same(ours, base) || same(theirs, ours)) continue;
        const conflict: SyncConflict = { localId: change.id, field, ours, theirs, base };
        engine.resolve(conflict, "theirs");
        resolved.push(conflict);
      }
    }
    return resolved;
  };

  return {
    engine,
    remote,
    async run() {
      const resolved = await preempt();
      const report = await engine.run();
      // Anything the engine still reports (a field that changed remotely twice between pulls) is rex's too.
      for (const conflict of report.conflicts) {
        engine.resolve(conflict, "theirs");
        resolved.push(conflict);
      }
      state = report.state;
      return { report, resolved };
    },
  };
}

export function startSync(options: StartSyncOptions): SyncHandle {
  const sync = createSync(options);
  const listeners = new Set<(status: SyncStatus) => void>();
  let status: SyncStatus = { running: false, resolved: [] };
  let inFlight: Promise<SyncStatus> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const tell = (next: SyncStatus) => {
    status = next;
    for (const listener of listeners) listener(status);
  };

  const runNow = (): Promise<SyncStatus> => {
    if (inFlight) return inFlight;
    tell({ ...status, running: true, error: undefined });
    inFlight = (async () => {
      try {
        const { report, resolved } = await sync.run();
        tell({ running: false, lastRun: new Date(), report, resolved });
      } catch (error) {
        tell({ ...status, running: false, lastRun: new Date(), error: error instanceof Error ? error.message : String(error) });
      } finally {
        inFlight = undefined;
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
      if (timer) clearTimeout(timer);
      clearInterval(interval);
    },
  };
}
