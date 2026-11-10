/**
 * Impact tags: small chips on an item row that tell a reader who does not read
 * code how big the work is, what kind of files it touches, and whether it
 * touches secrets or the parts much of the project depends on. Each chip's
 * tooltip names the files behind it.
 *
 * Fed by `GET /api/rex/impact` (server/item-impact.ts), loaded once and shared
 * by every row on the page; a load older than {@link STALE_MS} is refreshed the
 * next time a row mounts.
 *
 * Also home to {@link displayTitle}: the plain-language summary a row shows in
 * place of an item's technical title.
 *
 * @module viewer/components/impact-tags
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";

export type FileKind = "code" | "test" | "config" | "docs" | "other";

/** One item's impact. Mirrors `ItemImpact` in server/item-impact.ts. */
export interface ItemImpact {
  basis: "actual" | "expected";
  files: string[];
  fileCount: number;
  size: "small" | "medium" | "large" | null;
  kinds: Partial<Record<FileKind, number>>;
  security: string[];
  essential: string[];
}

export type ImpactMap = Readonly<Record<string, ItemImpact>>;

const STALE_MS = 30_000;
const KIND_LABELS: Record<FileKind, [one: string, many: string]> = {
  code: ["code file", "code files"],
  test: ["test", "tests"],
  config: ["config file", "config files"],
  docs: ["doc", "docs"],
  other: ["other file", "other files"],
};
const KIND_ORDER: readonly FileKind[] = ["code", "test", "config", "docs", "other"];
const SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large" } as const;
/** Files a tooltip lists before "and N more". */
const TOOLTIP_FILES = 12;

let cache: { at: number; data: ImpactMap } | null = null;
let pending: Promise<ImpactMap> | null = null;
const listeners = new Set<(data: ImpactMap) => void>();

function load(): Promise<ImpactMap> {
  pending ??= fetch("/api/rex/impact")
    .then(async (res) => (res.ok ? ((await res.json()) as { items?: ImpactMap }).items ?? {} : {}))
    .catch(() => ({}))
    .then((data) => {
      cache = { at: Date.now(), data };
      pending = null;
      for (const listener of listeners) listener(data);
      return data;
    });
  return pending;
}

/** Forget the shared load. Tests only. */
export function resetImpactCacheForTests(): void {
  cache = null;
  pending = null;
  listeners.clear();
}

/** Every item's impact, shared across rows. Empty until the first load answers. */
export function useItemImpacts(): ImpactMap {
  const [data, setData] = useState<ImpactMap>(cache?.data ?? {});
  useEffect(() => {
    listeners.add(setData);
    if (!cache || Date.now() - cache.at > STALE_MS) void load();
    return () => { listeners.delete(setData); };
  }, []);
  return data;
}

/**
 * What a row shows for an item: its plain-language summary when it has one,
 * else its title. The technical title stays on the full item view.
 */
export function displayTitle(item: { title: string; summary?: string | null }): string {
  return item.summary?.trim() || item.title;
}

const plural = (n: number, [one, many]: readonly [string, string]) => `${n} ${n === 1 ? one : many}`;

function fileList(files: readonly string[], total: number): string {
  const shown = files.slice(0, TOOLTIP_FILES);
  const rest = total - shown.length;
  return shown.join("\n") + (rest > 0 ? `\n…and ${rest} more` : "");
}

/** The kinds line, largest first: "9 code files · 3 tests · 1 doc". */
export function kindsText(kinds: ItemImpact["kinds"]): string {
  return KIND_ORDER
    .filter((k) => (kinds[k] ?? 0) > 0)
    .sort((a, b) => (kinds[b] ?? 0) - (kinds[a] ?? 0))
    .map((k) => plural(kinds[k]!, KIND_LABELS[k]))
    .join(" · ");
}

/** The size chip's text: "Large · 14 files", or "Large · ~14 files" when expected rather than measured. */
export function sizeText(impact: ItemImpact): string | null {
  if (!impact.size) return null;
  const approx = impact.basis === "expected" ? "~" : "";
  return `${SIZE_LABELS[impact.size]} · ${approx}${plural(impact.fileCount, ["file", "files"])}`;
}

/**
 * The chips for one item, or nothing when the item has no known impact.
 * `full` adds the file-kinds chip, for rows with room for it.
 */
export function ImpactTags({ impact, full = false }: { impact: ItemImpact | undefined; full?: boolean }) {
  if (!impact) return null;
  const source = impact.basis === "actual" ? "Files changed by runs on this item" : "Estimated from the files this item names";
  const size = sizeText(impact);
  const kinds = kindsText(impact.kinds);
  const chips = [
    impact.security.length > 0
      ? h("span", {
          key: "security",
          class: "impact-tag impact-security",
          title: `Touches secrets, keys or credentials:\n${fileList(impact.security, impact.security.length)}`,
        }, "Security")
      : null,
    impact.essential.length > 0
      ? h("span", {
          key: "essential",
          class: "impact-tag impact-essential",
          title: `Changes files much of the project depends on:\n${fileList(impact.essential, impact.essential.length)}`,
        }, "Essential")
      : null,
    size
      ? h("span", {
          key: "size",
          class: `impact-tag impact-size impact-size-${impact.size}`,
          title: `${source}:\n${fileList(impact.files, impact.fileCount)}`,
        }, size)
      : null,
    full && kinds
      ? h("span", { key: "kinds", class: "impact-tag impact-kinds", title: `${source}:\n${fileList(impact.files, impact.fileCount)}` }, kinds)
      : null,
  ].filter(Boolean);
  if (chips.length === 0) return null;
  return h("span", { class: "impact-tags", "data-basis": impact.basis }, chips);
}

/**
 * The detail panel's Impact section: the tags, where they came from, and the
 * files behind each, the file list folded so it does not crowd the panel.
 */
export function ImpactDetail({ impact }: { impact: ItemImpact | undefined }) {
  if (!impact) return null;
  const source = impact.basis === "actual"
    ? "From the files runs on this item changed."
    : "Estimated from the files this item names; runs replace it with what actually changed.";
  const list = (items: readonly string[]) => h("ul", { class: "impact-files" }, items.map((f) => h("li", { key: f }, h("code", null, f))));
  const hidden = impact.fileCount - impact.files.length;
  return h("div", { class: "task-section impact-detail" },
    h("div", { class: "task-section-label" }, "Impact"),
    h(ImpactTags, { impact, full: true }),
    h("p", { class: "impact-source" }, source),
    impact.security.length > 0
      ? h("div", null, h("div", { class: "impact-list-label" }, "Touches secrets, keys or credentials"), list(impact.security))
      : null,
    impact.essential.length > 0
      ? h("div", null, h("div", { class: "impact-list-label" }, "Files much of the project depends on"), list(impact.essential))
      : null,
    impact.fileCount > 0
      ? h("details", { class: "impact-all-files" },
          h("summary", null, `All ${plural(impact.fileCount, ["file", "files"])}`),
          list(impact.files),
          hidden > 0 ? h("p", { class: "impact-source" }, `…and ${hidden} more`) : null,
        )
      : null,
  );
}
