/**
 * The listbox menu behind a breadcrumb trigger, shared by the workspace
 * switcher and the project switcher so both answer the keyboard alike: Arrow
 * keys and Home/End move the highlight, Enter or Space chooses it, Escape
 * closes and returns focus to the trigger, Tab closes, and so does a click
 * outside the menu. Each switcher decides which keys open a closed menu.
 */

import { useEffect, useRef, useState } from "preact/hooks";

export function useBreadcrumbMenu<T>(options: readonly T[]) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /** The keys of an open menu; `choose` takes the highlighted option. */
  const onOpenMenuKey = (e: KeyboardEvent, choose: (option: T) => void) => {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setHighlight((i) => Math.min(options.length - 1, i + 1)); break;
      case "ArrowUp": e.preventDefault(); setHighlight((i) => Math.max(0, i - 1)); break;
      case "Home": e.preventDefault(); setHighlight(0); break;
      case "End": e.preventDefault(); setHighlight(options.length - 1); break;
      case "Enter":
      case " ": e.preventDefault(); if (options[highlight]) choose(options[highlight]); break;
      case "Escape": e.preventDefault(); setOpen(false); buttonRef.current?.focus(); break;
      case "Tab": setOpen(false); break;
    }
  };

  return { open, setOpen, highlight, setHighlight, rootRef, buttonRef, onOpenMenuKey };
}
