/**
 * Start a branch: a dialog that cuts a branch for one or more open changes.
 *
 * Fed by `GET /api/rex/branch/start` (the open changes with their slugs, the
 * current work-set branch and the default branch) and submitted to
 * `POST /api/rex/branch/start`. The name is prefilled `feat/<slug>` from the
 * first selected change and follows the selection until the user types in it.
 * Stacking on the current branch is offered only when that branch has a work set.
 *
 * A clean idle checkout is switched and the changes assigned there; the dialog
 * closes and `onSwitched` lets the page re-read. A dirty checkout or a live run
 * gets the branch only: the dialog says why it was not switched, shows the
 * switch command, and says the changes can be added from Work afterwards.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { announceBranchSwitched } from "../hooks/index.js";
import { ActionIcon } from "./action-icon.js";
import { BodyPortal } from "./body-portal.js";
import { CopyTextButton } from "./copy-text-button.js";

export interface StartBranchChange {
  id: string;
  displayId?: string;
  title: string;
  slug: string;
}

export interface StartBranchOptions {
  branch: string | null;
  /** The current branch has a work set: the only case stacking is offered. */
  workSet: boolean;
  defaultBranch: string | null;
  changes: StartBranchChange[];
}

type NotSwitched = { switched: false; branch: string; reason: "dirty" | "run-active"; switchCommand: string };

const TITLE_ID = "start-branch-title";

const NOT_SWITCHED_REASON: Record<NotSwitched["reason"], string> = {
  dirty: "it has uncommitted changes",
  "run-active": "a run is live in this checkout",
};

/**
 * The prefilled name for a change. The slug is repository content, so any
 * character outside [A-Za-z0-9._/-] (the set the server accepts) becomes `-`.
 */
export function branchNameFor(change: Pick<StartBranchChange, "slug">): string {
  return `feat/${change.slug.replace(/[^A-Za-z0-9._/-]/g, "-")}`;
}

export interface StartBranchDialogProps {
  /** The change the dialog was opened from, selected first. */
  preselect?: string;
  onClose: () => void;
  /** The checkout was switched to the new branch. */
  onSwitched?: () => void;
}

export function StartBranchDialog({ preselect, onClose, onSwitched }: StartBranchDialogProps) {
  const [options, setOptions] = useState<StartBranchOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Selected change ids, in the order they were picked: the first names the branch. */
  const [selected, setSelected] = useState<string[]>(preselect ? [preselect] : []);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [base, setBase] = useState<"default" | "current">("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notSwitched, setNotSwitched] = useState<NotSwitched | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/rex/branch/start");
        const data = (await res.json().catch(() => ({}))) as Partial<StartBranchOptions> & { error?: string };
        if (!live) return;
        if (!res.ok) {
          setLoadError(data.error || `Could not read the open changes (${res.status})`);
          return;
        }
        const changes = Array.isArray(data.changes) ? data.changes : [];
        setOptions({ branch: typeof data.branch === "string" ? data.branch : null, workSet: data.workSet === true, defaultBranch: data.defaultBranch ?? null, changes });
        // A preselected change that is not open is dropped, not sent.
        setSelected((ids) => ids.filter((id) => changes.some((c) => c.id === id)));
      } catch (err) {
        if (live) setLoadError(err instanceof Error ? err.message : "Could not read the open changes");
      }
    })();
    return () => { live = false; };
  }, []);

  // The name follows the first selected change until the user edits it.
  const first = options?.changes.find((c) => c.id === selected[0]);
  useEffect(() => {
    if (!nameEdited) setName(first ? branchNameFor(first) : "");
  }, [first?.id, nameEdited]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const toggle = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/branch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeIds: selected, name: name.trim(), base }),
      });
      const reply = (await res.json().catch(() => ({}))) as { switched?: boolean; error?: string } & Partial<NotSwitched>;
      if (!res.ok) {
        setError(reply.error || `Could not start the branch (${res.status})`);
      } else if (reply.switched) {
        announceBranchSwitched();
        onSwitched?.();
        onClose();
      } else {
        setNotSwitched(reply as NotSwitched);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the branch");
    } finally {
      setBusy(false);
    }
  }, [selected, name, base, onSwitched, onClose]);

  const onBackdrop = (e: MouseEvent) => {
    if (!busy && dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose();
  };

  let body;
  if (notSwitched) {
    body = h("div", { class: "prep-body start-branch-result", role: "status" },
      h("p", null, "Created branch ", h("code", null, notSwitched.branch), ". The checkout was not switched: ", NOT_SWITCHED_REASON[notSwitched.reason], "."),
      h("p", null, "Switch to it with:"),
      h("div", { class: "start-branch-command" },
        h("code", null, notSwitched.switchCommand),
        h(CopyTextButton, { text: notSwitched.switchCommand, class: "prep-btn" }),
      ),
      h("p", null, "After switching, Add the changes to the branch's work set from Work."),
    );
  } else if (loadError) {
    body = h("div", { class: "prep-body" }, h("p", { class: "prep-error", role: "alert" }, loadError));
  } else if (!options) {
    body = h("div", { class: "prep-body" }, h("p", { class: "prep-loading", role: "status" }, "Reading the open changes…"));
  } else {
    body = h("div", { class: "prep-body start-branch-form" },
      h("fieldset", { class: "start-branch-fieldset" },
        h("legend", null, "Changes"),
        options.changes.length === 0
          ? h("p", { class: "ready-empty" }, "No open changes.")
          : h("ul", { class: "start-branch-changes" },
              options.changes.map((c) => h("li", { key: c.id },
                h("label", { class: "start-branch-option" },
                  h("input", { type: "checkbox", checked: selected.includes(c.id), "data-change-id": c.id, onChange: () => toggle(c.id) }),
                  h("span", null, c.displayId ? `${c.displayId} · ${c.title}` : c.title),
                ),
              )),
            ),
      ),
      h("label", { class: "start-branch-name" },
        h("span", null, "Branch"),
        h("input", {
          type: "text",
          name: "branch-name",
          value: name,
          spellcheck: false,
          onInput: (e: Event) => { setNameEdited(true); setName((e.target as HTMLInputElement).value); },
        }),
      ),
      options.branch !== null && options.workSet
        ? h("fieldset", { class: "start-branch-fieldset start-branch-base" },
            h("legend", null, "Base"),
            h("label", { class: "start-branch-option" },
              h("input", { type: "radio", name: "start-branch-base", value: "default", checked: base === "default", onChange: () => setBase("default") }),
              h("span", null, "The default branch", options.defaultBranch ? ` (${options.defaultBranch})` : ""),
            ),
            h("label", { class: "start-branch-option" },
              h("input", { type: "radio", name: "start-branch-base", value: "current", checked: base === "current", onChange: () => setBase("current") }),
              h("span", null, "Stacked on ", h("code", null, options.branch)),
            ),
          )
        : h("p", { class: "start-branch-from" }, "Cut from the default branch", options.defaultBranch ? ` (${options.defaultBranch})` : "", "."),
      error ? h("p", { class: "prep-error", role: "alert" }, error) : null,
    );
  }

  const canSubmit = !!options && !notSwitched && selected.length > 0 && name.trim() !== "" && !busy;

  return h(BodyPortal, null,
    h("div", { class: "prep-backdrop", onClick: onBackdrop },
      h("div", { ref: dialogRef, class: "prep-modal start-branch-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": TITLE_ID },
        h("header", { class: "prep-header" },
          h("h2", { id: TITLE_ID, class: "prep-title" }, "Start a branch"),
          h("button", { type: "button", class: "prep-close", onClick: onClose, "aria-label": "Close" }, h(ActionIcon, { name: "close" })),
        ),
        body,
        h("footer", { class: "prep-footer" },
          h("button", { type: "button", class: "prep-btn", onClick: onClose }, notSwitched ? "Close" : "Cancel"),
          notSwitched
            ? null
            : h("button", { type: "button", class: "prep-btn prep-btn-primary", disabled: !canSubmit, onClick: () => void submit() }, busy ? "Starting…" : "Start branch"),
        ),
      ),
    ),
  );
}

/** A "Start a branch" button that owns its dialog. */
export function StartBranchButton({ changeId, ariaLabel, onSwitched }: {
  /** Preselected in the dialog. */
  changeId?: string;
  ariaLabel?: string;
  onSwitched?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return h("span", { class: "start-branch-trigger" },
    h("button", {
      type: "button",
      class: "prep-btn start-branch-btn",
      ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      onClick: () => setOpen(true),
    }, "Start a branch"),
    open ? h(StartBranchDialog, { preselect: changeId, onClose: () => setOpen(false), onSwitched }) : null,
  );
}
