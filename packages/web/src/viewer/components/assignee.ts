/**
 * Assigning work to people: the picker on Inbox rows, backlog rows and the
 * change detail panel, and the Mine / All / per-person filter over a list.
 *
 * The picker suggests the repository's known people (`GET /api/rex/people`:
 * git authors and product stewards, one per email) and takes any id or email
 * typed in for someone not listed. It writes the item's existing `assignee`
 * field, the one `ndx work --mine` selects by. The filter only hides rows.
 *
 * @module viewer/components/assignee
 */

import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { KnownPerson } from "../external.js";
import { errorMessage } from "../utils/format.js";
import { resolveCliLabel, useCliName } from "../hooks/index.js";
import {
  assigneeFilterOptions,
  assigneeFromInput,
  defaultAssigneeFilter,
  knownFilter,
  matchesAssigneeFilter,
  mineButNotForCli,
  personLabel,
  type AssignableRow,
  type AssigneeFilterOption,
  type AssigneeFilterValue,
  type PeopleRead,
} from "./assignee-model.js";

// ── People ───────────────────────────────────────────────────────────

const NO_PEOPLE: PeopleRead = { me: null, people: [] };
let peopleRead: Promise<PeopleRead> | null = null;
/** The read once it has answered, so a later mount has it on its first render. */
let resolvedPeople: PeopleRead | null = null;

/**
 * One read per page load, shared by every picker and filter on screen. A
 * failed read is nobody and is not kept, so the next mount asks again.
 */
function readPeople(): Promise<PeopleRead> {
  const failed = () => { peopleRead = null; return NO_PEOPLE; };
  peopleRead ??= Promise.resolve()
    .then(() => fetch("/api/rex/people"))
    .then(async (res): Promise<PeopleRead> => {
      if (!res?.ok) return failed();
      const body = await res.json() as Partial<PeopleRead>;
      resolvedPeople = { me: typeof body.me === "string" ? body.me : null, people: Array.isArray(body.people) ? body.people : [] };
      return resolvedPeople;
    })
    .catch(failed);
  return peopleRead;
}

/** Forget the cached read. Tests only. */
export function _resetPeopleForTests(): void {
  peopleRead = null;
  resolvedPeople = null;
}

/** Answer every read with `read` from the first render, as a page that has read it already does. Tests only. */
export function _primePeopleForTests(read: PeopleRead): void {
  resolvedPeople = read;
  peopleRead = Promise.resolve(read);
}

/**
 * The known people and the current user; null while unread (pending), so a
 * filter can wait for it instead of switching once it lands. Once a read has
 * answered on this page, a new mount has it on its first render. A failed read
 * is nobody.
 */
export function usePeople(): PeopleRead | null {
  const [read, setRead] = useState<PeopleRead | null>(() => resolvedPeople);
  useEffect(() => {
    let live = true;
    // Already on screen from the first render: no second render.
    readPeople().then((r) => { if (live) setRead((prev) => (prev === r ? prev : r)); });
    return () => { live = false; };
  }, []);
  return read;
}

/** `PATCH /api/rex/items/:id` with the assignee; an empty value clears it. Throws the server's reason. */
export async function saveAssignee(itemId: string, assignee: string): Promise<void> {
  const res = await fetch(`/api/rex/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignee }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
  }
}

// ── Picker ───────────────────────────────────────────────────────────

function optionLabel(p: KnownPerson): string {
  const name = p.name ?? personLabel(p.id);
  return p.email && p.email !== name ? `${name} · ${p.email}` : name;
}

export interface AssigneePickerProps {
  /** Names the suggestion list; unique on the page. */
  itemId: string;
  assignee?: string;
  /** Suggestions, from `pickerChoices`. */
  people: readonly KnownPerson[];
  /** Write the value; empty clears. A rejection is shown beside the picker. */
  onSave: (assignee: string) => Promise<void> | void;
  /** The current user; flags an assignee that is them by email but not to `ndx work --mine`. */
  me?: string | null;
}

/** Shown beside an assignee that is the current user by email but not in the CLI's spelling. */
export const NOT_MATCHED_BY_MINE = "not matched by {cli} work --mine";

/**
 * The assignee and a control to change it. Closed, it is one button naming
 * the assignee (or "Assign"); open, a text field with the known people as
 * suggestions. Clicks and keys stay inside it, so a row that opens on click
 * does not open when the picker is used.
 */
export function AssigneePicker({ itemId, assignee, people, onSave, me = null }: AssigneePickerProps) {
  const cliName = useCliName();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The saved value shows until the list is read again.
  const [shown, setShown] = useState(assignee);
  useEffect(() => setShown(assignee), [assignee]);
  const listId = `assignee-people-${itemId}`;

  const open = () => { setText(shown ?? ""); setError(null); setEditing(true); };
  const save = async (value: string) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      setShown(value || undefined);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return h("span", {
    class: "assignee-picker",
    "data-assignee": shown ?? "",
    onClick: (e: MouseEvent) => e.stopPropagation(),
    onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
  },
    editing
      ? h("form", {
          class: "assignee-form",
          onSubmit: (e: Event) => { e.preventDefault(); void save(assigneeFromInput(text, people)); },
        },
          h("input", {
            type: "text",
            class: "assignee-input",
            list: listId,
            value: text,
            placeholder: "Name, id or email",
            "aria-label": "Assignee",
            disabled: saving,
            ref: (el: HTMLInputElement | null) => el?.focus(),
            onInput: (e: Event) => setText((e.target as HTMLInputElement).value),
            onKeyDown: (e: KeyboardEvent) => { if (e.key === "Escape") setEditing(false); },
          }),
          h("datalist", { id: listId },
            people.map((p) => h("option", { key: p.id, value: p.id }, optionLabel(p)))),
          h("button", { type: "submit", class: "btn btn-sm assignee-save", disabled: saving }, "Save"),
          shown
            ? h("button", { type: "button", class: "btn btn-sm assignee-clear", disabled: saving, onClick: () => void save("") }, "Unassign")
            : null,
          h("button", { type: "button", class: "btn btn-sm assignee-cancel", disabled: saving, onClick: () => setEditing(false) }, "Cancel"),
        )
      : h("button", {
          type: "button",
          class: shown ? "assignee-button" : "assignee-button assignee-unassigned",
          title: shown ? `Assigned to ${shown}` : "Assign to someone",
          "aria-label": shown ? `Assignee: ${shown}. Change` : "Assign",
          onClick: open,
        }, shown ? personLabel(shown) : "Assign"),
    !editing && mineButNotForCli(shown, me)
      ? h("span", {
          class: "tag assignee-mismatch",
          title: `Saved as "${shown}"; ${cliName} work --mine selects only "${me}". Pick yourself again to save that spelling.`,
        }, resolveCliLabel(NOT_MATCHED_BY_MINE, cliName))
      : null,
    error ? h("span", { class: "assignee-error", role: "alert" }, error) : null,
  );
}

// ── Filter ───────────────────────────────────────────────────────────

export interface AssigneeFilterState {
  value: AssigneeFilterValue;
  options: AssigneeFilterOption[];
  pick: (value: AssigneeFilterValue) => void;
  /** Whether a row assigned to these people shows under the current value. Nothing shows while pending. */
  shows: (assignees: readonly string[]) => boolean;
  /**
   * True until the people list is read. The default depends on who the user
   * is, so a view holds its rows rather than show All and then switch to Mine.
   */
  pending: boolean;
}

/**
 * The filter over `rows`. Until the user picks, it follows the default: Mine
 * when the current user has open work assigned in the list, else All. A pick
 * that no longer names an option (that person's rows are gone) falls to All.
 * While `read` is null the filter is pending and shows no row.
 */
export function useAssigneeFilter(rows: readonly AssignableRow[], read: PeopleRead | null): AssigneeFilterState {
  const me = read?.me ?? null;
  const pending = read === null;
  const [picked, setPicked] = useState<AssigneeFilterValue | null>(null);
  const options = useMemo(() => assigneeFilterOptions(rows, me, read?.people), [rows, me, read]);
  const value = knownFilter(picked ?? defaultAssigneeFilter(rows, me), options);
  return {
    value,
    options,
    pick: setPicked,
    shows: (assignees) => !pending && matchesAssigneeFilter(assignees, value, me),
    pending,
  };
}

/** Where a held list would be while the people list is read. */
export function AssigneeFilterPending() {
  return h("div", { class: "assignee-filter-pending", role: "status", "aria-busy": "true" }, "Loading…");
}

/** The filter's control: a labelled select. */
export function AssigneeFilter({ state }: { state: AssigneeFilterState }) {
  return h("label", { class: "assignee-filter" },
    h("span", { class: "assignee-filter-label" }, "Assigned to"),
    h("select", {
      class: "assignee-filter-select",
      value: state.value,
      "aria-label": "Filter by assignee",
      onChange: (e: Event) => state.pick((e.target as HTMLSelectElement).value as AssigneeFilterValue),
    }, state.options.map((o) => h("option", { key: o.value, value: o.value }, o.label))),
  );
}
