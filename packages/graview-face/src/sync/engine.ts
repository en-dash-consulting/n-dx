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
 * RULE: rex wins. The engine's policy is `conflicts: "theirs"`: a field
 * edited on both sides since they last agreed takes rex's value through the
 * ordinary inbound act (so it lands in the log, authored by the system), and
 * the report says each one it settled. What rex kept is said in the rail,
 * never hidden. The engine guards the store while the loop runs, so an act
 * on a kind another tool owns is refused — and not offered — in the sentence
 * the mapping declares.
 */
import { SyncEngine, type RemoteLink, type SettledConflict, type SyncReport } from "@graview/core/sync";
import type { AnySchema, Store } from "@graview/core";
import { applyInbound, isSyncedKind, mapping, SYNC_FIELDS, VERSION_FIELD } from "./mapping.js";
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

export function createSync(options: SyncOptions): Sync {
  const remote = ndxRemote(options);
  const kinds = options.store.schema.kinds as readonly string[];
  const engine = new SyncEngine<AnySchema>({ store: options.store, mapping: mapping(kinds), remote, applyInbound, conflicts: "theirs" }, { links: unversionedLinks(options.store), outbox: [] });
  return {
    engine,
    remote,
    async run() {
      const report = await engine.run();
      const emit = remote.lastEmit();
      return { report, resolved: report.resolved, ...(emit ? { emit } : {}) };
    },
  };
}

export function startSync(options: StartSyncOptions): SyncHandle {
  const sync = createSync(options);
  const release = sync.engine.guard();
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
