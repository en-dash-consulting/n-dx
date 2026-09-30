/**
 * Shared frame for the three consolidated settings pages (Robot Wrangler,
 * Workflow, Project — see `settings-overlay.ts`).
 *
 * Controlled: the page owns its field values and hands the frame `dirty`,
 * `saving`, `error` and `onSave` (plus an optional `onDiscard` that restores
 * the last-saved values). The frame renders the page's fields as children,
 * an explicit Save button, an unsaved-changes indicator, and the
 * leave-with-unsaved-changes prompt from `useLeaveGuard` — modelled on
 * `prd-tree/delete-confirmation.ts`, with "Keep editing" and "Discard
 * changes" rather than `window.confirm`.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";
import { useLeaveGuard } from "../hooks/index.js";

export interface SettingsFrameProps {
  /** True whenever the page's values differ from what was last saved. */
  dirty: boolean;
  /** True while a save is in flight — disables Save and relabels it. */
  saving: boolean;
  /** Message from the last failed save, shown next to Save. */
  error?: string | null;
  /** Persist the page's current values. Awaited once per Save click. */
  onSave: () => Promise<void> | void;
  /** Restore the last-saved values, called when the user discards. */
  onDiscard?: () => void;
  /** The page's own fields. */
  children?: ComponentChildren;
}

export function SettingsFrame({ dirty, saving, error = null, onSave, onDiscard, children }: SettingsFrameProps) {
  const { promptOpen, keepEditing, discardChanges } = useLeaveGuard(dirty, onDiscard);
  const modalRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const handleSave = useCallback(() => {
    // onSave rejecting is the page's signal to keep `dirty` true and surface
    // `error` — the frame just needs to not let the rejection go unhandled.
    Promise.resolve(onSave()).catch(() => {});
  }, [onSave]);

  useEffect(() => {
    if (promptOpen) keepRef.current?.focus();
  }, [promptOpen]);

  useEffect(() => {
    if (!promptOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") keepEditing();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [promptOpen, keepEditing]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) keepEditing();
    },
    [keepEditing],
  );

  return h("div", { class: "settings-frame" },
    h("div", { class: "settings-frame-body" }, children),
    h("div", { class: "settings-frame-footer" },
      h("span", {
        class: `settings-frame-indicator${dirty ? " settings-frame-indicator--dirty" : ""}`,
        role: "status",
      }, dirty ? "Unsaved changes" : "All changes saved"),
      error ? h("span", { class: "settings-frame-error", role: "alert" }, error) : null,
      h("button", {
        type: "button",
        class: "settings-frame-save",
        disabled: !dirty || saving,
        onClick: handleSave,
      }, saving ? "Saving…" : "Save"),
    ),
    promptOpen
      ? h("div", {
          class: "leave-guard-backdrop",
          onClick: handleBackdropClick,
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "leave-guard-title",
        },
          h("div", { ref: modalRef, class: "leave-guard-modal" },
            h("div", { class: "leave-guard-header" },
              h("span", { class: "leave-guard-icon", "aria-hidden": "true" }, "⚠"),
              h("span", { id: "leave-guard-title", class: "leave-guard-title" }, "Unsaved changes"),
            ),
            h("p", { class: "leave-guard-message" }, "You have unsaved changes. Leaving now will lose them."),
            h("div", { class: "leave-guard-actions" },
              h("button", {
                ref: keepRef,
                type: "button",
                class: "leave-guard-keep-btn",
                onClick: keepEditing,
              }, "Keep editing"),
              h("button", {
                type: "button",
                class: "leave-guard-discard-btn",
                onClick: discardChanges,
              }, "Discard changes"),
            ),
          ),
        )
      : null,
  );
}
