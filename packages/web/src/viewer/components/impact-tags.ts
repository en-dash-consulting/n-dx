/**
 * Impact tags: small chips on an item row that tell a reader who does not read
 * code how big the work is, what kind of files it touches, and whether it
 * touches secrets or the parts much of the project depends on. Each chip's
 * tooltip names the files behind it.
 *
 * Fed by `GET /api/rex/impact` (server/item-impact.ts), loaded once and shared
 * by every row on the page. While any row is mounted, one shared socket
 * refetches it after a PRD write, a run change or a new analysis
 * (`rex:prd-changed`, `hench:run-changed`, `sv:data-changed`), so an open page
 * moves from expected to actual impact as runs land; a load older than
 * {@link STALE_MS} is also refreshed the next time a row mounts. A refetch that
 * fails keeps the impacts already shown.
 *
 * Also home to {@link displayTitle}: the short title or plain-language summary
 * a row shows in place of an item's full title, and {@link titleTooltip}.
 *
 * @module viewer/components/impact-tags
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { acceptsFrame } from "../base-path.js";
import { openFrameSocket } from "../live-feed-socket.js";

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

/** Frames after which an item's impact may have moved: a PRD write, a run's files, the import graph. */
const REFRESH_FRAMES: ReadonlySet<string> = new Set(["rex:prd-changed", "hench:run-changed", "sv:data-changed"]);
/**
 * A burst of frames (a bulk write, a run saving each turn) is one refetch per
 * this window. The server recomputes every item's impact per request, so a run
 * saving every second must not cost a recompute every second per open tab.
 */
const REFRESH_WINDOW_MS = 3_000;
/** A virtualized tree unmounts and mounts rows in one scroll: keep the socket across the gap. */
const FEED_LINGER_MS = 1_000;

let cache: { at: number; data: ImpactMap } | null = null;
let pending: Promise<ImpactMap> | null = null;
/** A change landed while a load was in flight: that load may predate it, so load again. */
let changedWhileLoading = false;
const listeners = new Set<(data: ImpactMap) => void>();
let feed: { close: () => void } | null = null;
let feedCloseTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Promise<ImpactMap> {
  pending ??= fetch("/api/rex/impact")
    .then(async (res) => (res.ok ? ((await res.json()) as { items?: ImpactMap }).items ?? {} : null))
    .catch(() => null)
    .then((loaded) => {
      pending = null;
      // A failed read keeps what rows already show, and stays stale so the next mount retries.
      if (loaded) {
        cache = { at: Date.now(), data: loaded };
        for (const listener of listeners) listener(loaded);
      }
      if (changedWhileLoading) {
        changedWhileLoading = false;
        void load();
      }
      return loaded ?? cache?.data ?? {};
    });
  return pending;
}

/** The impacts may have moved: refetch for the rows on screen, or forget the load when none are. */
function invalidate(): void {
  if (listeners.size === 0) {
    cache = null;
    return;
  }
  if (pending) {
    changedWhileLoading = true;
    return;
  }
  void load();
}

/** One socket for every mounted row; frames other than {@link REFRESH_FRAMES} are ignored. */
function openFeed(): void {
  if (feedCloseTimer) {
    clearTimeout(feedCloseTimer);
    feedCloseTimer = null;
  }
  if (feed) return;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  // With no socket, rows still refresh a load older than STALE_MS when they mount.
  const closeSocket = openFrameSocket((frame) => {
    if (!REFRESH_FRAMES.has(String(frame.type)) || !acceptsFrame(frame)) return;
    refreshTimer ??= setTimeout(() => {
      refreshTimer = null;
      invalidate();
    }, REFRESH_WINDOW_MS);
  });
  feed = {
    close: () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      closeSocket();
    },
  };
}

function releaseFeed(): void {
  if (listeners.size > 0 || !feed || feedCloseTimer) return;
  feedCloseTimer = setTimeout(() => {
    feedCloseTimer = null;
    if (listeners.size === 0 && feed) {
      feed.close();
      feed = null;
    }
  }, FEED_LINGER_MS);
}

/** Forget the shared load and close the shared socket. Tests only. */
export function resetImpactCacheForTests(): void {
  cache = null;
  pending = null;
  changedWhileLoading = false;
  listeners.clear();
  if (feedCloseTimer) clearTimeout(feedCloseTimer);
  feedCloseTimer = null;
  feed?.close();
  feed = null;
}

/** Every item's impact, shared across rows. Empty until the first load answers. */
export function useItemImpacts(): ImpactMap {
  const [data, setData] = useState<ImpactMap>(cache?.data ?? {});
  useEffect(() => {
    listeners.add(setData);
    openFeed();
    if (!cache || Date.now() - cache.at > STALE_MS) void load();
    // The shared load may have answered between this row's first render and now.
    else if (cache.data !== data) setData(cache.data);
    return () => {
      listeners.delete(setData);
      releaseFeed();
    };
  }, []);
  return data;
}

/** The fields {@link displayTitle} reads. */
export interface TitledItem {
  title: string;
  shortTitle?: string | null;
  summary?: string | null;
}

/**
 * What a row shows for an item: its short title when it has one, else its
 * plain-language summary, else its title. The full title stays on the item's
 * detail panel and is the row's tooltip ({@link titleTooltip}).
 */
export function displayTitle(item: TitledItem): string {
  return item.shortTitle?.trim() || item.summary?.trim() || item.title;
}

/** The full title, as a tooltip, wherever a row shows something else in its place. */
export function titleTooltip(item: TitledItem): string | undefined {
  return displayTitle(item) === item.title ? undefined : item.title;
}

/**
 * An item's name: its short title, else its title — never the summary. Rex's
 * `shownName`, the name short titles are unique by; for compact lists that
 * name items, such as the detail panel's dependencies and children.
 */
export function itemName(item: Pick<TitledItem, "title" | "shortTitle">): string {
  return item.shortTitle?.trim() || item.title;
}

/** The full title, as a tooltip, wherever {@link itemName} shows the short title. */
export function nameTooltip(item: Pick<TitledItem, "title" | "shortTitle">): string | undefined {
  return itemName(item) === item.title ? undefined : item.title;
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
function sourceOf(impact: ItemImpact): string {
  return impact.basis === "actual" ? "Files changed by runs on this item" : "Estimated from the files this item names";
}

/** The Security and Essential chips, for a row with no room for the rest. */
function flagChips(impact: ItemImpact) {
  return [
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
  ];
}

/** Only the Security and Essential flags, or nothing. */
export function ImpactFlags({ impact }: { impact: ItemImpact | undefined }) {
  const chips = impact ? flagChips(impact).filter(Boolean) : [];
  return chips.length > 0 ? h("span", { class: "impact-tags" }, chips) : null;
}

/** The size in one word ("Large"), with the count and files in its tooltip — for a table cell. */
export function sizeCell(impact: ItemImpact | undefined): { label: string; title: string | undefined } {
  if (!impact?.size) return { label: "—", title: impact ? undefined : "No files known yet" };
  return { label: SIZE_LABELS[impact.size], title: `${sizeText(impact)}\n${sourceOf(impact)}:\n${fileList(impact.files, impact.fileCount)}` };
}

export function ImpactTags({ impact, full = false }: { impact: ItemImpact | undefined; full?: boolean }) {
  if (!impact) return null;
  const source = sourceOf(impact);
  const size = sizeText(impact);
  const kinds = kindsText(impact.kinds);
  const chips = [
    ...flagChips(impact),
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
