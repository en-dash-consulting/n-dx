/**
 * N-eolithic easter egg overlay.
 *
 * Full-viewport dino animation triggered by the triple-click gesture detector.
 * Dismisses on any click or keypress.
 *
 * @module viewer/components/neolithic-overlay
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

// ── Dino ASCII art ─────────────────────────────────────────────────────────
//
// Adapted from packages/core/cli-brand.js QUADRANT_BODY + QUADRANT_LEGS.
// ANSI escape codes are stripped; web rendering uses CSS color instead.

const DINO_BODY = [
  "                        ",
  "          █████         ",
  "        ████████████    ",
  "        ███ ████████    ",
  "       █████████████    ",
  "      ████ █ ███████    ",
  "      ██          █     ",
  "       ██        █      ",
  "       ████ ██ ███      ",
  "      █████   █████     ",
  "  █████████    ████     ",
  "  ██████████   ██       ",
  "   ██████ ██   ██       ",
  "    ██████     ██       ",
  "     ██████   ███       ",
  "       ███   ████       ",
] as const;

// Two walking frames — only the legs change between frames.
const DINO_LEGS = [
  "        ████  ███       ", // frame 0 — both feet planted
  "       ████    ███      ", // frame 1 — stride
] as const;

const CAPTION =
  "Oops, you clicked so hard you ended up in the N-eolithic age with the N-Rex!";

const FRAME_MS = 400;

// ── Component ──────────────────────────────────────────────────────────────

export interface NeolithicOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export function NeolithicOverlay({ visible, onClose }: NeolithicOverlayProps) {
  console.log("Rendering NeolithicOverlay", { visible });
  const [frame, setFrame] = useState(0);

  // Walk animation — cycle legs while the overlay is visible.
  useEffect(() => {
    if (!visible) return;
    setFrame(0);
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % DINO_LEGS.length);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [visible]);

  // Dismiss on any keypress.
  useEffect(() => {
    if (!visible) return;
    const handler = () => onClose();
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, onClose]);

  if (!visible) return null;

  const dinoText = [...DINO_BODY, DINO_LEGS[frame]].join("\n");

  return h(
    "div",
    {
      class: "neolithic-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "N-eolithic easter egg — click anywhere to dismiss",
      onClick: onClose,
    },
    h(
      "div",
      { class: "neolithic-overlay-content" },
      h(
        "pre",
        { class: "neolithic-dino", "aria-hidden": "true" },
        dinoText,
      ),
      h(
        "p",
        { class: "neolithic-caption" },
        CAPTION,
      ),
    ),
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

/** Custom DOM event name fired by the gesture detector. */
export const NEOLITHIC_EVENT = "ndx:neolithic" as const;

/**
 * Controls for the neolithic overlay.
 * Returns [isOpen, open, close].
 *
 * The overlay can be opened two ways:
 * 1. Call `open()` directly (e.g., when `openNeolithic` is threaded via props).
 * 2. Dispatch `new CustomEvent(NEOLITHIC_EVENT)` on `window` — the hook listens
 *    for this event so the gesture detector does not need prop access.
 */
export function useNeolithicOverlay(): [boolean, () => void, () => void] {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Listen for the decoupled event fired by the gesture detector.
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener(NEOLITHIC_EVENT, handler);
    return () => window.removeEventListener(NEOLITHIC_EVENT, handler);
  }, []);

  return [isOpen, open, close];
}
