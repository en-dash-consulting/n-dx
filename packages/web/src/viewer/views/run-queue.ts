/**
 * The planned run queue: tasks lined up, in order, for the agent to run next
 * (`GET`/`PUT /api/hench/queue`, saved in the hench directory). `ndx work`
 * takes the first one that can run before its own pick, and takes it off.
 *
 * One store per page shares the queue between its panels (Work › Now, Plan ›
 * Preparation) and Ready to run's "Add to queue". It reads again when a run
 * starts or ends, since a run takes its item off the queue.
 *
 * @module viewer/views/run-queue
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import { useHenchRunsLiveRefresh } from "../hooks/index.js";

export interface QueueItem {
  taskId: string;
  addedAt: string;
  title?: string;
  status?: string;
  priority?: string | null;
  /** No longer in the PRD: `ndx work` will drop it. */
  missing?: true;
}

interface QueueState {
  items: QueueItem[] | null;
  error: string | null;
}

let state: QueueState = { items: null, error: null };
const listeners = new Set<(s: QueueState) => void>();
let inflight: Promise<void> | null = null;

function publish(next: QueueState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

/** Read the queue from the server (one read at a time, shared by every panel). */
export function refreshRunQueue(): Promise<void> {
  inflight ??= (async () => {
    try {
      const res = await fetch("/api/hench/queue");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { items?: QueueItem[] };
      publish({ items: Array.isArray(body.items) ? body.items : [], error: null });
    } catch (err) {
      publish({ items: state.items ?? [], error: `Could not read the run queue: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Save `taskIds` as the queue's order; the answer is the queue as saved. */
export async function saveRunQueue(taskIds: readonly string[]): Promise<boolean> {
  try {
    const res = await fetch("/api/hench/queue", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds }),
    });
    const body = await res.json().catch(() => null) as { items?: QueueItem[]; error?: string } | null;
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    publish({ items: Array.isArray(body?.items) ? body!.items! : [], error: null });
    return true;
  } catch (err) {
    publish({ items: state.items, error: `Could not save the run queue: ${err instanceof Error ? err.message : String(err)}` });
    return false;
  }
}

const ids = () => (state.items ?? []).map((i) => i.taskId);

/** Put a task at the end of the queue (no-op when it is already on it). */
export function addToRunQueue(taskId: string): Promise<boolean> {
  return ids().includes(taskId) ? Promise.resolve(true) : saveRunQueue([...ids(), taskId]);
}

/** Move the item at `index` up (-1) or down (+1). */
export function moveInRunQueue(index: number, by: -1 | 1): Promise<boolean> {
  const order = ids();
  const to = index + by;
  if (to < 0 || to >= order.length) return Promise.resolve(true);
  [order[index], order[to]] = [order[to]!, order[index]!];
  return saveRunQueue(order);
}

export function removeFromRunQueue(taskId: string): Promise<boolean> {
  return saveRunQueue(ids().filter((id) => id !== taskId));
}

/** The queue, read once per page and kept current across its panels. */
export function useRunQueue(): QueueState {
  const [view, setView] = useState<QueueState>(state);
  useEffect(() => {
    listeners.add(setView);
    setView(state);
    if (state.items === null) void refreshRunQueue();
    return () => { listeners.delete(setView); };
  }, []);
  // A run starting takes its item off the queue.
  useHenchRunsLiveRefresh(refreshRunQueue);
  return view;
}

/** Forget the shared queue. Tests only. */
export function _resetRunQueueForTests(): void {
  state = { items: null, error: null };
  inflight = null;
}

interface ReadyOption { id: string; title: string }

/** The ready tasks not yet queued, read when the add picker opens. */
function AddPicker({ queued, onDone }: { queued: ReadonlySet<string>; onDone: () => void }) {
  const [options, setOptions] = useState<ReadyOption[] | null>(null);
  const [choice, setChoice] = useState("");
  useEffect(() => {
    let live = true;
    void fetch("/api/hench/ready?all=1")
      .then((res) => (res.ok ? res.json() : { tasks: [] }))
      .then((body: { tasks?: Array<{ id: string; title: string; shortTitle?: string }> }) => {
        if (live) setOptions((body.tasks ?? []).map((t) => ({ id: t.id, title: t.shortTitle || t.title })));
      })
      .catch(() => { if (live) setOptions([]); });
    return () => { live = false; };
  }, []);
  const left = (options ?? []).filter((o) => !queued.has(o.id));
  return h("div", { class: "rq-add" },
    options === null
      ? h("span", { class: "rq-note", role: "status" }, "Loading ready tasks…")
      : left.length === 0
        ? h("span", { class: "rq-note" }, "Every ready task is already queued.")
        : [
            h("select", {
              key: "s",
              class: "rq-select",
              "aria-label": "Ready task to add",
              value: choice,
              onChange: (e: Event) => setChoice((e.target as HTMLSelectElement).value),
            }, h("option", { value: "" }, "Choose a ready task…"), left.map((o) => h("option", { key: o.id, value: o.id }, o.title))),
            h("button", {
              key: "a",
              type: "button",
              class: "prep-btn prep-btn-primary",
              disabled: !choice,
              onClick: async () => { if (choice && await addToRunQueue(choice)) { setChoice(""); onDone(); } },
            }, "Add"),
          ],
    h("button", { type: "button", class: "prep-btn", onClick: onDone }, "Close"),
  );
}

/** The Queue panel: the lined-up tasks, reorderable, with an add picker. */
export function RunQueuePanel({ navigateTo }: { navigateTo: NavigateTo }) {
  const { items, error } = useRunQueue();
  const [adding, setAdding] = useState(false);
  const queued = new Set((items ?? []).map((i) => i.taskId));
  return h("div", { class: "rq" },
    h("p", { class: "rq-intro" }, "The agent runs these next, top first, before its own pick."),
    error ? h("p", { class: "rq-error", role: "alert" }, error) : null,
    items === null
      ? h("p", { class: "rq-note", role: "status" }, "Loading…")
      : items.length === 0
        ? h("p", { class: "rq-note" }, "Nothing queued. Add a ready task here, or from Ready to run on Work › Tune.")
        : h("ol", { class: "rq-list", "aria-label": "Run queue" },
            items.map((item, index) => h("li", { key: item.taskId, class: item.missing ? "rq-item rq-item--missing" : "rq-item", "data-task-id": item.taskId },
              h("span", { class: "rq-pos", "aria-hidden": "true" }, String(index + 1)),
              h("div", { class: "rq-main" },
                item.missing
                  ? h("span", { class: "rq-title" }, item.taskId)
                  : h("button", { type: "button", class: "rq-title", onClick: () => navigateTo("prd", { taskId: item.taskId }) }, item.title),
                h("span", { class: "rq-meta" },
                  item.missing
                    ? "No longer in the PRD; the next run drops it"
                    : [item.status ?? "", item.priority ? ` · ${item.priority}` : ""].join("")),
              ),
              h("div", { class: "rq-actions" },
                h("button", { type: "button", class: "rq-btn", disabled: index === 0, "aria-label": `Move ${item.title ?? item.taskId} up`, title: "Move up", onClick: () => void moveInRunQueue(index, -1) }, "↑"),
                h("button", { type: "button", class: "rq-btn", disabled: index === items.length - 1, "aria-label": `Move ${item.title ?? item.taskId} down`, title: "Move down", onClick: () => void moveInRunQueue(index, 1) }, "↓"),
                h("button", { type: "button", class: "rq-btn", "aria-label": `Remove ${item.title ?? item.taskId} from the queue`, title: "Remove", onClick: () => void removeFromRunQueue(item.taskId) }, "✕"),
              ),
            )),
          ),
    adding
      ? h(AddPicker, { queued, onDone: () => setAdding(false) })
      : h("button", { type: "button", class: "prep-btn rq-add-open", onClick: () => setAdding(true) }, "+ Add a ready task"),
  );
}
