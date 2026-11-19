/**
 * An item's short title and the name the dashboard shows for it.
 *
 * The shown name is the short title when an item has one, else its title. It
 * must be unique among open items (pending, in_progress, failing, blocked,
 * deferred):
 * a short title that matches another open item's shown name is refused,
 * naming that item. Items in any other status (completed above all) are
 * exempt, so a follow-up to finished work may reuse its name. Names compare
 * trimmed, with runs of whitespace collapsed and case ignored.
 *
 * Works on v1 items and v2 change-layer nodes alike: both carry `id`,
 * `title`, `status` and `children`.
 *
 * @module rex/core/short-title
 */

/** Statuses whose items' shown names must be unique. A missing status reads as pending. */
export const NAME_HOLDING_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "failing", "blocked", "deferred"]);

/** The fields the name rule reads from an item or node. */
export interface NamedItem {
  id: string;
  title: string;
  shortTitle?: unknown;
  status?: string;
  displayId?: unknown;
  type?: unknown;
  level?: unknown;
  children?: readonly NamedItem[];
}

/** The item's short title, trimmed, or undefined when it has none. */
export function shortTitleOf(item: { shortTitle?: unknown }): string | undefined {
  return typeof item.shortTitle === "string" && item.shortTitle.trim() ? item.shortTitle.trim() : undefined;
}

/** The name the UI shows: the short title, else the title. */
export function shownName(item: { title: string; shortTitle?: unknown }): string {
  return shortTitleOf(item) ?? item.title;
}

/** Whether an item in `status` holds its shown name against other open items. */
export function holdsName(status: string | undefined): boolean {
  return NAME_HOLDING_STATUSES.has(status ?? "pending");
}

const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The open item, other than `selfId`, whose shown name matches `name`. */
export function findNameCollision(items: readonly NamedItem[], name: string, selfId?: string): NamedItem | undefined {
  const key = nameKey(name);
  if (!key) return undefined;
  const stack = [...items];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.id !== selfId && holdsName(item.status) && nameKey(shownName(item)) === key) return item;
    if (item.children) stack.push(...item.children);
  }
  return undefined;
}

/** A short title refused because an open item already shows that name. */
export class ShortTitleCollisionError extends Error {
  /** The open item whose shown name matches. */
  readonly collidingId: string;

  constructor(shortTitle: string, other: NamedItem) {
    const kind = typeof other.type === "string" ? other.type : typeof other.level === "string" ? other.level : "item";
    const ref = typeof other.displayId === "string" ? `${other.displayId}, ${other.id}` : other.id;
    const title = shortTitleOf(other) ? `"${shownName(other)}" (${other.title})` : `"${other.title}"`;
    super(
      `Short title "${shortTitle}" is already the name of open ${kind} ${title} [${ref}], status ${other.status ?? "pending"}. ` +
        "Names must be unique among pending, in-progress, failing, blocked and deferred items; choose another short title.",
    );
    this.name = "ShortTitleCollisionError";
    this.collidingId = other.id;
  }
}

/**
 * Refuse `shortTitle` for the item `selfId` (absent for a new item) when an
 * open item in `items` already shows that name. A blank short title clears it
 * and is always accepted, as is any short title on an item whose own status
 * does not hold a name (`selfStatus`, pending when absent).
 */
export function assertShortTitleAvailable(
  items: readonly NamedItem[],
  shortTitle: string | undefined,
  self: { id?: string; status?: string } = {},
): void {
  const name = shortTitle?.trim();
  if (!name || !holdsName(self.status)) return;
  const other = findNameCollision(items, name, self.id);
  if (other) throw new ShortTitleCollisionError(name, other);
}
