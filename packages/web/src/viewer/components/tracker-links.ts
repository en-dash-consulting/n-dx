/**
 * An item's links to tracker work items (story 44), shown on the task, change
 * and Live pages.
 *
 * The server owns what a link is (a v2 item's `issues`, a v1 item's `links[]`)
 * and sends the refs: `GET /api/rex/items/:id/links` here, the task snapshot
 * on Live. {@link TrackerLinkList} reads them: each as the tracker's label
 * reads it ("CAOS WM-2054"), a link when the ref is a URL.
 * {@link TrackerLinksEditor} adds Link and Unlink beside it, through `POST` /
 * `DELETE` on the same route. The label is the tracker profile's, from
 * `GET /api/connections/tracker`, and absent until a connection names one.
 */

import { h } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

/** The ref as a link target when it is a URL; a bare tracker key has none. */
export function linkHref(ref: string): string | null {
  return /^https?:\/\//.test(ref) ? ref : null;
}

/** What a ref reads as: the tracker's label in front of its key or host, or the key or host alone. */
export function linkText(ref: string, label: string | null | undefined): string {
  const href = linkHref(ref);
  let tail = ref;
  if (href) {
    try {
      tail = new URL(href).host;
    } catch {
      tail = ref;
    }
  }
  return label ? `${label} ${tail}` : tail;
}

let cachedLabel: Promise<string | null> | null = null;

/** The tracker's label, read once per page load; null while no connection names a tracker profile or the read fails. */
function readTrackerLabel(): Promise<string | null> {
  cachedLabel ??= fetch("/api/connections/tracker")
    .then((res) => (res.ok ? (res.json() as Promise<{ label?: string | null }>) : { label: null }))
    .then((body) => (typeof body.label === "string" ? body.label : null))
    .catch(() => null);
  return cachedLabel;
}

/** Forget the label, so the next read asks again (a connection or profile changed). */
export function resetTrackerLabel(): void {
  cachedLabel = null;
}

/** The tracker's label from its profile, or null until read. */
export function useTrackerLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readTrackerLabel().then((value) => { if (live) setLabel(value); });
    return () => { live = false; };
  }, []);
  return label;
}

/** One ref: a link when it is a URL, else its key. */
function RefText({ refText, label }: { refText: string; label: string | null }) {
  const href = linkHref(refText);
  const text = linkText(refText, label);
  return href
    ? h("a", { class: "tracker-link", href, target: "_blank", rel: "noopener noreferrer", title: refText }, text)
    : h("span", { class: "tracker-link" }, text);
}

/** The read-only list; nothing when the item has no link. */
export function TrackerLinkList({ refs, label }: { refs: readonly string[]; label: string | null }) {
  if (refs.length === 0) return null;
  return h("span", { class: "tracker-links", "data-tracker-links": "" },
    refs.map((ref) => h(RefText, { key: ref, refText: ref, label })),
  );
}

export interface TrackerLinksEditorProps {
  itemId: string;
  /** Changes whenever the page reloaded its item, so the refs are read again. */
  refreshKey?: unknown;
  /** Called after the server wrote a change, so the page can reload the item. */
  onChanged?: () => void;
}

/** Link and Unlink on an item's page. */
export function TrackerLinksEditor({ itemId, refreshKey, onChanged }: TrackerLinksEditorProps) {
  const label = useTrackerLabel();
  const [refs, setRefs] = useState<readonly string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/rex/items/${encodeURIComponent(itemId)}/links`;

  // The item's refs as the server holds them: on first show, for another item, and after the page reloaded it.
  useEffect(() => {
    let live = true;
    setRefs([]);
    void fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<{ refs?: string[] }>) : { refs: [] }))
      .then((body) => { if (live && Array.isArray(body.refs)) setRefs(body.refs); })
      .catch(() => { /* The list stays empty; Link still works and says why it cannot. */ });
    return () => { live = false; };
  }, [url, refreshKey]);

  const send = useCallback(async (method: "POST" | "DELETE", ref: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref }) });
      const body = (await res.json().catch(() => ({}))) as { refs?: string[]; error?: string };
      if (!res.ok) {
        setError(body.error ?? `The server answered ${res.status}`);
        return false;
      }
      if (Array.isArray(body.refs)) setRefs(body.refs);
      onChanged?.();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [url, onChanged]);

  const link = useCallback(async () => {
    const ref = draft.trim();
    if (!ref) return;
    if (await send("POST", ref)) {
      setDraft("");
      setAdding(false);
    }
  }, [draft, send]);

  return h("div", { class: "tracker-links-editor" },
    refs.map((ref) =>
      h("span", { key: ref, class: "tracker-link-row" },
        h(RefText, { refText: ref, label }),
        h("button", {
          type: "button",
          class: "tracker-unlink",
          disabled: busy,
          title: `Unlink ${ref}`,
          "aria-label": `Unlink ${ref}`,
          onClick: () => { void send("DELETE", ref); },
        }, "Unlink"),
      ),
    ),
    adding
      ? h("span", { class: "tracker-link-input-wrapper" },
          h("input", {
            class: "tracker-link-input",
            type: "text",
            value: draft,
            placeholder: "WM-2054 or a URL",
            "aria-label": "Tracker work item key or URL",
            onInput: (e: Event) => { setDraft((e.target as HTMLInputElement).value); setError(null); },
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter") { e.preventDefault(); void link(); }
              if (e.key === "Escape") { setAdding(false); setDraft(""); setError(null); }
            },
            ref: (el: HTMLInputElement | null) => el?.focus(),
          }),
          h("button", { type: "button", class: "tracker-link-confirm", disabled: busy, onClick: () => { void link(); } }, "Link"),
        )
      : h("button", { type: "button", class: "tracker-link-add", onClick: () => setAdding(true) }, "+ link"),
    error ? h("div", { class: "tracker-link-error", role: "alert" }, error) : null,
  );
}
