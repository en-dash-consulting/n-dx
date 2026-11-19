/**
 * The assignee picker's choices and the assignee filter's rules, with no UI.
 *
 * A person is keyed by email (`identityKey`), so `Ann <ann@x.io>` assigned
 * from the CLI and `ann@x.io` typed here are the same person to the filter.
 * "Mine" is the current user as `ndx work --mine` resolves them.
 *
 * @module viewer/components/assignee-model
 */

import { identityKey, type KnownPerson } from "../external.js";

/** The answer of `GET /api/rex/people`. */
export interface PeopleRead {
  /** The current user (rex's `resolveActor`); null when the server could not tell. */
  me: string | null;
  people: KnownPerson[];
}

/** The filter's value: Mine, All, or one person by `identityKey`. */
export type AssigneeFilterValue = "mine" | "all" | `person:${string}`;

export interface AssigneeFilterOption {
  value: AssigneeFilterValue;
  label: string;
}

/**
 * A row the filter judges: everyone it is assigned to (a change's own assignee
 * and its open tasks', each of which `ndx work --mine` selects by), and
 * whether it is still open work.
 */
export interface AssignableRow {
  assignees: readonly string[];
  open: boolean;
}

/** How an identity reads in a row: the name, else the email, else the text. */
export function personLabel(identity: string): string {
  const named = /^(.*?)\s*<[^<>]*>\s*$/.exec(identity.trim());
  return named?.[1] || identity.trim().replace(/^<|>$/g, "");
}

/** Whether `assignee` names the current user. */
export function isMine(assignee: string | undefined, me: string | null): boolean {
  return !!assignee && !!me && identityKey(assignee) === identityKey(me);
}

/**
 * Whether `assignee` is the current user by email but not in the exact
 * spelling `ndx work --mine` matches (`Ann <ann@x.io>` against `Ann Lee
 * <ann@x.io>`, or a bare email). The dashboard counts it as Mine; the CLI
 * never selects it, so the row says so.
 */
export function mineButNotForCli(assignee: string | undefined, me: string | null): boolean {
  return isMine(assignee, me) && assignee!.trim() !== me!.trim();
}

/** Mine when the current user is assigned an open row (or an open task in one), otherwise All. */
export function defaultAssigneeFilter(rows: readonly AssignableRow[], me: string | null): AssigneeFilterValue {
  return rows.some((r) => r.open && r.assignees.some((a) => isMine(a, me))) ? "mine" : "all";
}

/** Whether a row assigned to `assignees` shows under `filter`: any one of them matching is enough. All shows every row. */
export function matchesAssigneeFilter(assignees: readonly string[], filter: AssigneeFilterValue, me: string | null): boolean {
  if (filter === "all") return true;
  if (filter === "mine") return assignees.some((a) => isMine(a, me));
  const key = filter.slice("person:".length);
  return assignees.some((a) => !!a.trim() && identityKey(a) === key);
}

/**
 * Mine (when the user is known), All, then one option per person assigned in
 * `rows`, by name. The list's own assignees, so every option shows something;
 * a person in `known` is labelled by the name the repository knows them by.
 */
export function assigneeFilterOptions(
  rows: readonly AssignableRow[],
  me: string | null,
  known: readonly KnownPerson[] = [],
): AssigneeFilterOption[] {
  const names = new Map(known.filter((p) => p.name).map((p) => [identityKey(p.id), p.name!]));
  const people = new Map<string, string>();
  for (const { assignees } of rows) {
    for (const assignee of assignees) {
      if (!assignee.trim()) continue;
      const key = identityKey(assignee);
      if (!people.has(key)) people.set(key, names.get(key) ?? personLabel(assignee));
    }
  }
  const persons = [...people.entries()]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([key, label]): AssigneeFilterOption => ({ value: `person:${key}`, label }));
  return [
    ...(me ? [{ value: "mine" as const, label: "Mine" }] : []),
    { value: "all", label: "All" },
    ...persons,
  ];
}

/** A value the filter can keep: one of `options`, else All. */
export function knownFilter(value: AssigneeFilterValue, options: readonly AssigneeFilterOption[]): AssigneeFilterValue {
  return options.some((o) => o.value === value) ? value : "all";
}

/**
 * The picker's suggestions: the known people, plus anyone already assigned in
 * the list who is not among them (someone typed in before), keyed by email.
 */
export function pickerChoices(people: readonly KnownPerson[], assigned: readonly (string | undefined)[]): KnownPerson[] {
  const keys = new Set(people.map((p) => identityKey(p.id)));
  const extra: KnownPerson[] = [];
  for (const raw of assigned) {
    const id = raw?.trim();
    if (!id || keys.has(identityKey(id))) continue;
    keys.add(identityKey(id));
    extra.push({ id, sources: [] });
  }
  return [...people, ...extra];
}

/**
 * What the picker's text saves. A known person's email (or any spelling with
 * it) saves that person's id, the form `ndx work --mine` matches; anything else
 * is saved as typed, trimmed, for someone not in the repository yet. Empty
 * clears the assignee.
 */
export function assigneeFromInput(text: string, people: readonly KnownPerson[]): string {
  const typed = text.trim();
  if (!typed) return "";
  const key = identityKey(typed);
  return people.find((p) => identityKey(p.id) === key)?.id ?? typed;
}
