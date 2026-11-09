/**
 * The Work page's top: the branch's work set, then Ready to run.
 *
 * Fed by `GET /api/rex/work-set`. When the checked-out branch has a work set the
 * page opens with "On this branch" (grouped by change, each with Remove) and
 * "Not on a branch" (the other open changes and tasks, each with Add). On the
 * default branch, a detached HEAD and a branch nothing is assigned to, neither
 * section renders and the page is Ready to run alone. A refusal (409, such as a
 * live run) shows its message inline and changes nothing. Add and Remove reload
 * the read and Ready to run.
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { useCliName, resolveCliLabel, useHenchRunsLiveRefresh } from "../hooks/index.js";
import { ReadyToRun, type ReadyToRunProps } from "./ready-to-run.js";

/** A unit of the `/api/rex/work-set` reply. */
export interface WorkSetUnit {
  id: string;
  displayId?: string;
  title: string;
  status: string;
  /** On the branch through its change, not in its own right. */
  inherited: boolean;
}

export interface WorkSetGroup {
  change: { id: string; displayId?: string; title: string };
  units: WorkSetUnit[];
}

export interface WorkSetRead {
  branch: string | null;
  workSet: boolean;
  groups: WorkSetGroup[];
  others: WorkSetGroup[];
}

const STATUS_LABEL: Record<string, string> = { pending: "Pending", in_progress: "In progress", failing: "Failing" };
const STATUS_ICON: Record<string, string> = { pending: "○", in_progress: "◐", failing: "✗" };

const INHERITED_NOTE = "This task is on the branch through its change. Remove the change to take it off.";

/** The work set read, reloaded on run frames and after a write. Null until the first answer, and on a server without the route. */
export function useWorkSet() {
  const [read, setRead] = useState<WorkSetRead | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rex/work-set");
      if (!res.ok) return;
      const data = (await res.json()) as Partial<WorkSetRead>;
      setRead({
        branch: typeof data.branch === "string" ? data.branch : null,
        workSet: data.workSet === true,
        groups: Array.isArray(data.groups) ? data.groups : [],
        others: Array.isArray(data.others) ? data.others : [],
      });
    } catch {
      // Keep what is shown: the sections are an addition to the page, never its gate.
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useHenchRunsLiveRefresh(load);
  /** Reload the read and tell Ready to run to reload too. */
  const refresh = useCallback(async () => {
    await load();
    setVersion((v) => v + 1);
  }, [load]);
  return { read, version, refresh };
}

interface SectionsProps {
  read: WorkSetRead;
  onChanged: () => Promise<void>;
}

const label = (n: { displayId?: string; title: string }) => (n.displayId ? `${n.displayId} · ${n.title}` : n.title);

function WorkSetSections({ read, onChanged }: SectionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  /** The last refusal or explanation, shown once under the sections. */
  const [message, setMessage] = useState<string | null>(null);

  const write = async (action: "add" | "remove", id: string) => {
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/rex/work-set/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      if (res.ok) {
        await onChanged();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(data.error || `Could not ${action} (${res.status})`);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Could not ${action}`);
    } finally {
      setBusy(null);
    }
  };

  const unitRow = (unit: WorkSetUnit, action: "add" | "remove") =>
    h("li", { key: unit.id, class: "work-set-row work-set-unit", "data-unit-id": unit.id },
      h("span", { class: `prd-status-icon prd-status-${unit.status}`, title: STATUS_LABEL[unit.status] ?? unit.status, "aria-label": STATUS_LABEL[unit.status] ?? unit.status }, STATUS_ICON[unit.status] ?? "○"),
      h("span", { class: "work-set-title" }, label(unit)),
      unit.inherited ? h("span", { class: "work-set-via" }, "via its change") : null,
      h("button", {
        type: "button",
        class: "prep-btn work-set-btn",
        disabled: busy === unit.id,
        "aria-label": `${action === "add" ? "Add" : "Remove"} ${unit.title}`,
        onClick: () => (unit.inherited && action === "remove" ? setMessage(INHERITED_NOTE) : void write(action, unit.id)),
      }, action === "add" ? "Add" : "Remove"),
    );

  const groupBlock = (group: WorkSetGroup, action: "add" | "remove") => {
    // A task-less change is its own only unit: the header is the row.
    const own = group.units.length === 1 && group.units[0]!.id === group.change.id;
    const units = own ? [] : group.units;
    const head = own ? group.units[0]! : null;
    return h("section", { key: group.change.id, class: "work-set-group", "data-change-id": group.change.id },
      h("div", { class: "work-set-row work-set-change" },
        head
          ? h("span", { class: `prd-status-icon prd-status-${head.status}`, title: STATUS_LABEL[head.status] ?? head.status, "aria-label": STATUS_LABEL[head.status] ?? head.status }, STATUS_ICON[head.status] ?? "○")
          : null,
        h("h3", { class: "work-set-change-title" }, label(group.change)),
        h("button", {
          type: "button",
          class: "prep-btn work-set-btn",
          disabled: busy === group.change.id,
          "aria-label": `${action === "add" ? "Add" : "Remove"} change ${group.change.title}`,
          onClick: () => void write(action, group.change.id),
        }, action === "add" ? "Add" : "Remove"),
      ),
      units.length ? h("ul", { class: "work-set-list" }, units.map((u) => unitRow(u, action))) : null,
    );
  };

  return h("div", { class: "work-set" },
    h("section", { class: "work-set-section", "aria-labelledby": "work-set-on-title" },
      h("h2", { id: "work-set-on-title", class: "ready-title-head" }, "On this branch ", h("code", { class: "work-set-branch" }, read.branch)),
      read.groups.length
        ? read.groups.map((g) => groupBlock(g, "remove"))
        : h("p", { class: "ready-empty" }, "No open work is on this branch."),
    ),
    read.others.length
      ? h("section", { class: "work-set-section", "aria-labelledby": "work-set-off-title" },
          h("h2", { id: "work-set-off-title", class: "ready-title-head" }, "Not on a branch"),
          read.others.map((g) => groupBlock(g, "add")),
        )
      : null,
    message ? h("div", { class: "ready-toast ready-toast-error work-set-message", role: "alert" }, message) : null,
  );
}

/** The Work page's top: the work set's sections when the branch has one, then Ready to run. */
export function WorkQueue(props: ReadyToRunProps) {
  const { read, version, refresh } = useWorkSet();
  const cliName = useCliName();
  const set = read && read.branch !== null && read.workSet ? read : null;
  return h("div", { class: "work-queue" },
    set ? h(WorkSetSections, { read: set, onChanged: refresh }) : null,
    h(ReadyToRun, {
      ...props,
      reloadKey: version,
      emptyNote: set
        ? resolveCliLabel("Nothing left in this branch's work set. To pick outside it, run {cli} work --any.", cliName)
        : undefined,
    }),
  );
}
