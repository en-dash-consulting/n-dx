/**
 * Pieces the Live task page (`live-task.ts`) and the Live analysis page
 * (`live-analyze.ts`) share: the side-column section, a list that follows its
 * newest entry, and the header's Copy link.
 *
 * @module web/viewer/views/live-shared
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/** A titled section of the side column; `id` names its heading for `aria-labelledby`. */
export function SideSection({ id, title, children }: { id: string; title: string; children?: ComponentChildren }) {
  return h("section", { class: "live-side-section", "aria-labelledby": id },
    h("h3", { id, class: "live-side-title" }, title),
    children,
  );
}

/**
 * Keep a scrolling element at its newest entry while following. Scrolling up
 * to read stops following; reaching the bottom resumes it. `deps` are the
 * values that change when an entry arrives.
 */
export function useFollowScroll(
  ref: { current: HTMLElement | null },
  deps: readonly unknown[],
): { following: boolean; follow: () => void; onScroll: () => void } {
  const [following, setFollowing] = useState(true);
  const programmatic = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !following) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
  }, [...deps, following]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (programmatic.current) { programmatic.current = false; return; }
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  }, []);

  return { following, follow: () => setFollowing(true), onScroll };
}

/** Copy this page's address to the clipboard; resolves to the notice to show. */
export async function copyPageLink(): Promise<string> {
  try {
    await navigator.clipboard.writeText(location.href);
    return "Link copied";
  } catch {
    return "Could not copy the link";
  }
}
