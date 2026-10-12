/**
 * Item type — the dashboard's node vocabulary, and the v1 `level` shim.
 *
 * **This module is the only web source that reads or writes a v1 `level`.**
 * Everything else — routes, views, components, hooks — reads `itemTypeOf(item)`
 * and keys on {@link ItemType}. Schema v2 replaced `level` with `type`
 * (see `packages/rex/src/schema/v2.ts`), but v1 trees are still on disk and
 * still served, so the two vocabularies coexist until the v2 reader is wired
 * into the server.
 *
 * ## The vocabulary is the union, not the v2 set
 *
 * `ItemType` holds both v1's levels and v2's node types. It is tempting to
 * project `epic`/`feature` onto v2's `change` at read time — rex's dual-read
 * loader does exactly that, in `V1_LEVEL_TYPES` — but the dashboard renders
 * what the tree says, and collapsing both onto `change`
 * would relabel every epic and feature in a v1 PRD as a change and lose the
 * distinction the tree still stores. Collapsing is the migration's job
 * (`ndx migrate`), not the reader's. So a v1 item reads as its own level and a
 * v2 node reads as its own type, and consumers switch on the union.
 *
 * ## Framework- and package-neutral
 *
 * `src/shared/` is bundled into the browser, so this file cannot import
 * `@n-dx/rex`. The v1 half therefore mirrors rex's `LEVEL_HIERARCHY` /
 * `CHILD_LEVEL`, as `viewer/components/prd-tree/levels.ts` did before it;
 * `tests/unit/shared/item-type-contract.test.ts` pins the mirror against rex
 * so the two cannot drift.
 *
 * @module web/shared/item-type
 * @see packages/rex/src/schema/v1.ts — canonical levels
 * @see packages/rex/src/schema/v2.ts — canonical node types
 */

// ── Vocabulary ───────────────────────────────────────────────────────

/** v1 levels. Still written by the v1 folder-tree store. */
export const V1_LEVELS = ["epic", "feature", "task", "subtask"] as const;
export type V1Level = (typeof V1_LEVELS)[number];

/** v2 product-layer node types: the product as built. */
export const PRODUCT_TYPES = ["area", "capability", "constraint"] as const;
/** v2 change-layer node types: linear work that closes. */
export const CHANGE_TYPES = ["change", "task", "subtask"] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type ChangeType = (typeof CHANGE_TYPES)[number];

/**
 * Every node type the dashboard can be handed. `task` and `subtask` are in
 * both storage versions and mean the same thing in each.
 */
export type ItemType = V1Level | ProductType | ChangeType;

/** The union, in reading order: product layer, then change layer, then v1-only. */
export const ITEM_TYPES: readonly ItemType[] = [
  "area", "capability", "constraint",
  "change", "task", "subtask",
  "epic", "feature",
];

const ITEM_TYPE_SET: ReadonlySet<string> = new Set(ITEM_TYPES);

/** Type guard: narrows an arbitrary string to a known node type. */
export function isItemType(value: unknown): value is ItemType {
  return typeof value === "string" && ITEM_TYPE_SET.has(value);
}

/** True for a v2 product-layer type. */
export function isProductType(type: string): type is ProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(type);
}

// ── The shim ─────────────────────────────────────────────────────────

/** Anything carrying a node type: a v2 node, a v1 item, or an API body. */
export interface ItemTypeCarrier {
  type?: string;
  level?: string;
}

/**
 * The type of an item, from `type` when the tree is v2 and from `level` when
 * it is v1. **The one `level` read in the web package.**
 *
 * Deliberately unvalidated, exactly as the `item.level` it replaced was: every
 * storage path produces one of the two fields, and the label tables below all
 * fall back on the raw string, so a reader gains nothing from a null branch it
 * could not act on.
 */
export function itemTypeOf(item: ItemTypeCarrier): ItemType {
  return (item.type || item.level || "") as ItemType;
}

/**
 * The v1 level to store a type as, or `null` when the v1 tree has no level for
 * it. **The one `level` write in the web package.**
 *
 * A `change` has no single level: at the root it is an epic, under one it is a
 * feature — hence `parentType`. The product-layer types have no v1 level at
 * all; a caller writing to a v1 tree must refuse them rather than guess.
 */
export function levelOf(type: string, parentType?: string): V1Level | null {
  switch (type) {
    case "epic": case "feature": case "task": case "subtask":
      return type;
    case "change":
      return parentType ? "feature" : "epic";
    default:
      return null;
  }
}

// ── Hierarchy ────────────────────────────────────────────────────────

/**
 * Parent types each type may sit under; `null` means "may sit at the root".
 * The v1 half mirrors rex's `LEVEL_HIERARCHY`. The product half follows v2's
 * `layer-nesting` rule: a capability goes under an area or a top-level
 * capability, a constraint under an area.
 *
 * `change` is the one entry that is not purely one version's: v2 keeps changes
 * flat, but a v1 tree stores a root change as an epic and a nested one as a
 * feature ({@link levelOf}), so a change nested under an epic or another
 * change has to be expressible.
 */
export const TYPE_PARENTS: Readonly<Record<ItemType, ReadonlyArray<ItemType | null>>> = {
  epic: [null],
  feature: ["epic"],
  task: ["feature", "epic", "change"],
  subtask: ["task", "subtask"],
  area: [null],
  capability: ["area", "capability"],
  constraint: [null, "area"],
  change: [null, "epic", "change"],
};

/** The default child type, or `null` when the type takes no children. */
export const CHILD_TYPE: Readonly<Record<ItemType, ItemType | null>> = {
  epic: "feature",
  feature: "task",
  task: "subtask",
  subtask: "subtask",
  area: "capability",
  capability: "capability",
  constraint: null,
  change: "task",
};

/** Can this type sit at the tree root? */
export function isRootType(type: string): boolean {
  return isItemType(type) && TYPE_PARENTS[type].includes(null);
}

/**
 * Is this an actionable unit of work rather than a grouping?
 *
 * A task-less `change` is itself the unit `ndx work` runs, but it reads as a
 * container here because the dashboard asks this question to decide whether a
 * row can be started, and a change's tasks are what get started.
 */
export function isWorkItemType(type: string): boolean {
  return type === "task" || type === "subtask";
}

/** Does this type group other items? */
export function isContainerType(type: string): boolean {
  return isItemType(type) && !isWorkItemType(type);
}

/** The default child type, or `null` for an unknown or childless type. */
export function childTypeOf(type: string): ItemType | null {
  return isItemType(type) ? CHILD_TYPE[type] : null;
}

/**
 * Types the dashboard offers an inline "add child" on.
 *
 * Narrower than `CHILD_TYPE` having an entry: rex allows a subtask under a
 * subtask and a capability under a capability, but the tree does not offer to
 * nest either, so the affordance is listed rather than derived. Named once
 * here because the tree and the detail panel both gate on it and used to keep
 * separate copies that could disagree.
 */
export const ADDABLE_TYPES: ReadonlySet<ItemType> = new Set<ItemType>([
  "epic", "feature", "task", "change", "area",
]);

/** May the dashboard offer to add a child under this type? */
export function canAddChildType(type: string): boolean {
  return isItemType(type) && ADDABLE_TYPES.has(type);
}

/** Parent types excluding the root marker. e.g. `task` → `["feature", "epic", "change"]`. */
export function parentTypesOf(type: string): ItemType[] {
  if (!isItemType(type)) return [];
  return TYPE_PARENTS[type].filter((p): p is ItemType => p !== null);
}

/** May a child of `childType` sit under a parent of `parentType` (`null` = root)? */
export function isValidParentType(childType: string, parentType: string | null): boolean {
  if (!isItemType(childType)) return false;
  return TYPE_PARENTS[childType].includes(parentType as ItemType | null);
}

// ── Display ──────────────────────────────────────────────────────────

/**
 * Singular labels. The dashboard's copy, not rex's `LevelDisplay` — rex's is
 * user-overridable through `.n-dx.json` and server-resolved, and the viewer is
 * static browser code with no access to it.
 *
 * Terminology decided 2026-10-08: a capability's `criteria` are its **capability
 * criteria**; a work item's `acceptanceCriteria` are **done when**. See
 * {@link CRITERIA_LABEL}.
 */
export const ITEM_TYPE_LABELS: Readonly<Record<ItemType, string>> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
  area: "Area",
  capability: "Capability",
  constraint: "Constraint",
  change: "Change",
};

export const ITEM_TYPE_PLURAL: Readonly<Record<ItemType, string>> = {
  epic: "Epics",
  feature: "Features",
  task: "Tasks",
  subtask: "Subtasks",
  area: "Areas",
  capability: "Capabilities",
  constraint: "Constraints",
  change: "Changes",
};

export const ITEM_TYPE_EMOJI: Readonly<Record<ItemType, string>> = {
  epic: "\u{1F4E6}",       // 📦
  feature: "\u{2728}",     // ✨
  task: "\u{1F4CB}",       // 📋
  subtask: "\u{1F539}",    // 🔹
  area: "\u{1F5FA}",       // 🗺
  capability: "\u{1F9E9}", // 🧩
  constraint: "\u{1F6E1}", // 🛡
  change: "\u{1F504}",     // 🔄
};

/** Display label for a type, falling back to the raw string. */
export function itemTypeLabel(type: string): string {
  return isItemType(type) ? ITEM_TYPE_LABELS[type] : type;
}

/** Plural display label, falling back to a naive plural. */
export function itemTypePlural(type: string): string {
  return isItemType(type) ? ITEM_TYPE_PLURAL[type] : `${type}s`;
}

/** Emoji for a type, falling back to a bullet. */
export function itemTypeEmoji(type: string): string {
  return isItemType(type) ? ITEM_TYPE_EMOJI[type] : "•";
}

/**
 * What to call this node's criteria list.
 *
 * A capability's `criteria` are the product's standing spec; a change's or
 * task's `acceptanceCriteria` are that piece of work's finish line. They are
 * different fields with different lifetimes, so they get different names
 * rather than one shared "Acceptance criteria" heading (decided 2026-10-08).
 */
export function criteriaLabel(type: string): string {
  return type === "capability" ? CRITERIA_LABEL.capability : CRITERIA_LABEL.work;
}

export const CRITERIA_LABEL = {
  capability: "Capability criteria",
  work: "Done when",
} as const;
