/**
 * Prepare task — every per-task `ndx work` option for one run, before it starts.
 *
 * Fed by `GET /api/hench/prep/:taskId`: hench's resolved settings with the
 * source of each, the refusals a run would hit, the vendor's model catalog,
 * the workspace and the hub's admission state. The modal shows which fields
 * changed, the preflight list, the equivalent terminal command, and a brief
 * preview, and Execute posts `{taskId, options}` with the changed fields alone.
 *
 * A change can be for this run or for the task. Execute carries the edits and
 * nothing else; Save writes them onto the PRD item through
 * `PUT /api/hench/prep/:taskId`, where `ndx work` reads them from a terminal
 * too. Two buttons on purpose: "run it differently once" and "this is how this
 * task should be run" are different intentions, and conflating them would make
 * every experiment permanent.
 *
 * A save carries the version the GET reported, so one made against a read
 * someone else has overtaken is refused rather than silently winning; the 409
 * brings back the current block, and the conflict panel offers Reload or
 * Overwrite.
 *
 * Start lives here and Stop lives in Live: a started run hands off to
 * `/live/task/:taskId`. A run the hub queues stays here, showing its position.
 *
 * Every request names the workspace with `X-Ndx-Workspace` when the modal was
 * opened for one other than the viewer's own (a Workspaces card); otherwise the
 * viewer's base-path fetch addresses its own workspace.
 *
 * All state derivation is in `prepare-task-model.ts`; this file renders it.
 */

import { h, Fragment } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useEffect, useCallback, useRef, useMemo } from "preact/hooks";
import { useFocusTrap } from "../hooks/index.js";
import { QueuedNotice } from "./queued-notice.js";
import { RUN_OPTION_SPECS } from "../external.js";
import type { RunOptionKey } from "../external.js";
import {
  admissionLine,
  changeCount,
  commandLine,
  defaultsOf,
  effective,
  isChanged,
  maxTurnsApplies,
  modelChoices,
  optionsProblem,
  providerChoices,
  resetField,
  runOptionsOf,
  setField,
  sourceOf,
  isSavedOnTask,
  fallbackOf,
  saveBodyOf,
  saveCount,
  savedCount,
  standingRefusals,
  workspaceWarnings,
} from "./prepare-task-model.js";
import type { PrepDefaults, PrepEdits, PrepResponse, QueuedReply } from "./prepare-task-model.js";

export interface PrepareTaskModalProps {
  taskId: string;
  /** Address this workspace instead of the viewer's own (sent as `X-Ndx-Workspace`). */
  workspace?: string;
  onClose: () => void;
  /** Open the task's Live page — after a start, or from the queued notice. */
  onOpenLive: (taskId: string) => void;
  /**
   * Where the task's Live page is when it is not in this viewer's workspace.
   * Used as the queued notice's link target; clicks still go through `onOpenLive`.
   */
  liveHref?: (taskId: string) => string;
}

const TITLE_ID = "prepare-task-title";

type Reply = { ok: boolean; status: number; data: Record<string, unknown> };

const PERMISSION_MODES = RUN_OPTION_SPECS.find((s) => s.key === "permissionMode")?.values ?? [];

/**
 * Keyed by task id, so a different `taskId` is a different modal: edits, preview
 * and queued state belong to the task they were made for and are never carried
 * to another one, whichever host mounts this.
 */
export function PrepareTaskModal(props: PrepareTaskModalProps) {
  return h(PrepareTaskModalBody, { key: props.taskId, ...props });
}

function PrepareTaskModalBody({ taskId, workspace, onClose, onOpenLive, liveHref }: PrepareTaskModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [prep, setPrep] = useState<PrepResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<PrepEdits>({});
  const [preview, setPreview] = useState<{ brief: string | null; error: string | null; loading: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [canMigrate, setCanMigrate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Set when a save lost a race: the block and version the server holds now. */
  const [conflict, setConflict] = useState<{ saved: Record<string, unknown> | null; version: string } | null>(null);
  /** The inline confirm before clearing a task's saved settings. */
  const [confirmClear, setConfirmClear] = useState(false);
  const [queued, setQueued] = useState<QueuedReply | null>(null);
  // The hub dropped the queued run at its turn; Execute is offered again.
  const [queueDropped, setQueueDropped] = useState(false);
  const onQueueDropped = useCallback(() => setQueueDropped(true), []);

  // Focus moves in on open — to the close button, the first control, so the
  // trap's wrap points hold from the start — and goes back to whatever opened
  // the modal on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(".prep-close")?.focus();
    return () => {
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, []);
  useFocusTrap(dialogRef, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase + stopImmediatePropagation: a host's own document
      // Escape listener (the PRD detail panel) must not also close.
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // GET with no body, POST with one, and PUT when the caller says so (saving
  // run settings). The workspace header travels on all three: a modal opened
  // for another worktree must read AND write that worktree.
  const request = useCallback(async (path: string, body?: unknown, method?: "PUT"): Promise<Reply> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (workspace) headers["X-Ndx-Workspace"] = workspace;
    const res = await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { ok: res.ok, status: res.status, data: data as Record<string, unknown> };
  }, [workspace]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const reply = await request(`/api/hench/prep/${encodeURIComponent(taskId)}`);
      if (!reply.ok) {
        setLoadError((reply.data.error as string) || `Could not load the run settings (${reply.status})`);
        return;
      }
      setPrep(reply.data as unknown as PrepResponse);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the run settings");
    }
  }, [request, taskId]);
  useEffect(() => { void load(); }, [load]);

  const defaults = useMemo(() => (prep ? defaultsOf(prep) : null), [prep]);

  /**
   * Write the task's run settings.
   *
   * `block` is what to save; `null` clears. The version travels so the server
   * can refuse a save made against a read someone else has since overtaken —
   * a 409 brings back the current block, which is what the conflict panel
   * offers to reload or overwrite.
   */
  const saveSettings = useCallback(async (block: Record<string, unknown> | null, version: string) => {
    setBusy(true);
    setSaveError(null);
    setConflict(null);
    setNotice(null);
    try {
      const reply = await request(
        `/api/hench/prep/${encodeURIComponent(taskId)}`,
        { run: block, version },
        "PUT",
      );
      if (reply.status === 409 && reply.data.conflict === true) {
        setConflict({
          saved: (reply.data.saved ?? null) as Record<string, unknown> | null,
          version: String(reply.data.version ?? "none"),
        });
        return false;
      }
      if (!reply.ok) {
        setSaveError((reply.data.error as string) || `Could not save (${reply.status})`);
        return false;
      }
      // Reload rather than patch local state: the sources, the fallbacks and
      // the version all move with a save, and the server is the one that knows
      // what they became.
      await load();
      setEdits({});
      const workspaceInfo = reply.data.workspace as { branch?: string; isAnchor?: boolean } | undefined;
      setNotice(
        block === null
          ? "Cleared the settings saved on this task"
          : workspaceInfo && workspaceInfo.isAnchor === false
            ? `Saved on branch ${workspaceInfo.branch ?? "this worktree"}; lands when the branch merges`
            : "Saved",
      );
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save the run settings");
      return false;
    } finally {
      setBusy(false);
    }
  }, [request, taskId, load]);

  /** Save what the modal shows now. */
  const save = useCallback(() => {
    if (!prep || !defaults) return;
    setConfirmClear(false);
    void saveSettings(saveBodyOf(prep, defaults, edits), prep.savedVersion ?? "none");
  }, [prep, defaults, edits, saveSettings]);

  /** Clear the task's saved settings outright. */
  const clearSaved = useCallback(() => {
    if (!prep) return;
    setConfirmClear(false);
    void saveSettings(null, prep.savedVersion ?? "none");
  }, [prep, saveSettings]);

  /** Take the server's version of the settings and drop the local edits. */
  const reloadFromConflict = useCallback(() => {
    setConflict(null);
    setEdits({});
    void load();
  }, [load]);

  /** Save again against the version the refusal named — which is the overwrite. */
  const overwriteConflict = useCallback(() => {
    if (!prep || !defaults || !conflict) return;
    void saveSettings(saveBodyOf(prep, defaults, edits), conflict.version);
  }, [prep, defaults, edits, conflict, saveSettings]);

  const execute = useCallback(async () => {
    if (!defaults) return;
    setBusy(true);
    setExecError(null);
    setNotice(null);
    setCanMigrate(false);
    setQueued(null);
    setQueueDropped(false);
    try {
      const reply = await request("/api/hench/execute", { taskId, options: runOptionsOf(defaults, edits) });
      if (reply.ok && reply.data.queued === true) {
        setQueued(reply.data as unknown as QueuedReply);
        return;
      }
      if (reply.ok) {
        onOpenLive(taskId);
        return;
      }
      setExecError((reply.data.error as string) || `Failed (${reply.status})`);
      if (reply.data.migratable === true) setCanMigrate(true);
    } catch (err) {
      setExecError(err instanceof Error ? err.message : "Failed to start the run");
    } finally {
      setBusy(false);
    }
  }, [defaults, edits, request, taskId, onOpenLive]);

  // Same second, explicit request StartTaskButton makes: migrating is consent
  // on its own, and it does not start the task.
  const migrate = useCallback(async () => {
    setBusy(true);
    try {
      const reply = await request("/api/hench/execute", { taskId, migrateSlugs: true });
      if (!reply.ok) {
        setExecError((reply.data.error as string) || `Migration failed (${reply.status})`);
        if (reply.status === 409) setCanMigrate(false);
        return;
      }
      setCanMigrate(false);
      setExecError(null);
      setNotice((reply.data.message as string) || "The PRD tree was migrated.");
      await load();
    } catch (err) {
      setExecError(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setBusy(false);
    }
  }, [request, taskId, load]);

  // Each preview request, and each Back, takes a new number; a reply whose
  // number is no longer current was asked for options the reader has since left
  // (Back, then an edit, or a newer request) and must not reopen the preview.
  const previewSeq = useRef(0);
  // Set by Back so the Preview button, once the form is back, takes focus.
  const returnToPreviewButton = useRef(false);

  const showPreview = useCallback(async () => {
    if (!defaults) return;
    const seq = ++previewSeq.current;
    setPreview({ brief: null, error: null, loading: true });
    try {
      const reply = await request(`/api/hench/prep/${encodeURIComponent(taskId)}/preview`, {
        options: runOptionsOf(defaults, edits),
      });
      if (seq !== previewSeq.current) return;
      const brief = typeof reply.data.brief === "string" ? reply.data.brief : null;
      setPreview({
        brief,
        error: reply.ok ? null : (reply.data.error as string) || `Preview failed (${reply.status})`,
        loading: false,
      });
    } catch (err) {
      if (seq !== previewSeq.current) return;
      setPreview({ brief: null, error: err instanceof Error ? err.message : "Preview failed", loading: false });
    }
  }, [defaults, edits, request, taskId]);

  const closePreview = useCallback(() => {
    previewSeq.current++;
    returnToPreviewButton.current = true;
    setPreview(null);
  }, []);

  // Toggling swaps the focused button out of the DOM; put focus where the
  // reader's place is: the preview heading on open, the Preview button on Back.
  const previewOpen = preview !== null;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (previewOpen) {
      dialog.querySelector<HTMLElement>(".prep-preview-title")?.focus();
    } else if (returnToPreviewButton.current) {
      returnToPreviewButton.current = false;
      dialog.querySelector<HTMLElement>(".prep-preview-btn")?.focus();
    }
  }, [previewOpen]);

  const onBackdrop = useCallback((e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  let body: ComponentChildren;
  if (loadError) {
    body = h("div", { class: "prep-body" },
      h("p", { class: "prep-error", role: "alert" }, loadError),
      h("button", { type: "button", class: "prep-btn", onClick: () => void load() }, "Retry"),
    );
  } else if (!prep || !defaults) {
    body = h("div", { class: "prep-body" }, h("p", { class: "prep-loading", role: "status" }, "Reading the run settings…"));
  } else if (preview) {
    body = h(PreviewPanel, { preview, onBack: closePreview });
  } else {
    body = h(Form, {
      prep, defaults, edits, setEdits, taskId, busy, execError, canMigrate, notice, queued, queueDropped, onQueueDropped,
      saveError, conflict, confirmClear, setConfirmClear,
      onSave: save, onClearSaved: clearSaved,
      onReloadConflict: reloadFromConflict, onOverwriteConflict: overwriteConflict,
      onExecute: execute, onMigrate: migrate, onPreview: showPreview, onOpenLive, liveHref,
    });
  }

  return h("div", { class: "prep-backdrop", onClick: onBackdrop },
    h("div", {
      ref: dialogRef,
      class: "prep-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": TITLE_ID,
    },
      h(Header, { prep, taskId, onClose }),
      body,
    ),
  );
}

// ── Header ───────────────────────────────────────────────────────────

function Header({ prep, taskId, onClose }: { prep: PrepResponse | null; taskId: string; onClose: () => void }) {
  const task = prep?.task ?? null;
  const detail = prep?.detail ?? null;
  return h("header", { class: "prep-header" },
    h("div", { class: "prep-header-text" },
      h("h2", { id: TITLE_ID, class: "prep-title" }, "Prepare task"),
      task ? h("div", { class: "prep-task-title" }, task.title) : null,
      detail && detail.parentChain.length > 0
        ? h("div", { class: "prep-parent-chain" }, detail.parentChain.join(" › "))
        : null,
      h("div", { class: "prep-task-meta" },
        task ? h("span", { class: "prep-chip" }, task.status) : null,
        detail?.priority ? h("span", { class: "prep-chip" }, detail.priority) : null,
        detail ? h("span", { class: "prep-chip" }, `${detail.criteriaCount} criteria`) : null,
        h("span", { class: "prep-chip prep-chip-id", title: taskId }, taskId.slice(0, 8)),
      ),
    ),
    h("button", { type: "button", class: "prep-close", onClick: onClose, "aria-label": "Close" }, "×"),
  );
}

// ── Form ─────────────────────────────────────────────────────────────

interface FormProps {
  prep: PrepResponse;
  defaults: PrepDefaults;
  edits: PrepEdits;
  setEdits: (edits: PrepEdits) => void;
  taskId: string;
  busy: boolean;
  execError: string | null;
  canMigrate: boolean;
  notice: string | null;
  queued: QueuedReply | null;
  queueDropped: boolean;
  onQueueDropped: () => void;
  saveError: string | null;
  conflict: { saved: Record<string, unknown> | null; version: string } | null;
  confirmClear: boolean;
  setConfirmClear: (on: boolean) => void;
  onSave: () => void;
  onClearSaved: () => void;
  onReloadConflict: () => void;
  onOverwriteConflict: () => void;
  onExecute: () => void;
  onMigrate: () => void;
  onPreview: () => void;
  onOpenLive: (taskId: string) => void;
  liveHref?: (taskId: string) => string;
}

function Form(props: FormProps) {
  const { prep, defaults, edits, setEdits, taskId, busy, execError, canMigrate, notice, queued } = props;
  const { saveError, conflict, confirmClear, setConfirmClear } = props;
  const set = (key: RunOptionKey, value: unknown) => {
    let next = setField(defaults, edits, key, value);
    // Turning review off drops its model, so the field does not linger as a change.
    if (key === "review" && value !== true) next = resetField(next, "reviewModel");
    setEdits(next);
  };
  const reset = (key: RunOptionKey) => setEdits(resetField(edits, key));
  const field = (key: RunOptionKey) => ({
    id: `prep-${key}`,
    source: sourceOf(prep, key),
    saved: isSavedOnTask(prep, key),
    fallback: fallbackOf(prep, key),
    changed: isChanged(edits, key),
    onReset: () => reset(key),
  });

  const reviewOn = effective(defaults, edits, "review") === true;
  const turnsApply = maxTurnsApplies(defaults, edits);
  const refusals = standingRefusals(prep, defaults, edits);
  const warnings = workspaceWarnings(prep);
  const admission = admissionLine(prep.admission);
  const problem = optionsProblem(defaults, edits);
  const changes = changeCount(defaults, edits);
  const alreadySaved = savedCount(prep);
  const hasEdits = Object.keys(edits).length > 0;
  const offAnchor = prep.workspace.isAnchor === false;
  const resume = prep.task?.status === "in_progress";
  const blocked = refusals.length > 0 || problem !== null;
  const command = commandLine(prep, taskId, defaults, edits);
  const model = effective(defaults, edits, "model");
  const reviewModel = effective(defaults, edits, "reviewModel");
  const vendorDefault = prep.resolved.reviewModel.vendorDefault;
  const maxTurns = effective(defaults, edits, "maxTurns");
  const tokenBudget = effective(defaults, edits, "tokenBudget");
  const permissionModes = [...new Set([defaults.permissionMode, ...PERMISSION_MODES])];

  return h(Fragment, null,
    h("div", { class: "prep-body" },
      h(Section, { title: "Where" },
        h("p", { class: "prep-where" },
          h("span", { class: "prep-where-key" }, prep.workspace.key ?? "anchor"),
          prep.workspace.branch ? h("span", { class: "prep-where-branch" }, ` on ${prep.workspace.branch}`) : null,
          h("span", { class: "prep-where-root" }, ` — ${prep.workspace.root}`),
        ),
        warnings.map((w) => h("p", { key: w, class: "prep-warning" }, w)),
      ),

      h(Section, { title: "Model" },
        h(ReadOnlyField, { id: "prep-vendor", label: "Vendor", source: prep.resolved.vendor.source },
          h("input", { id: "prep-vendor", type: "text", readOnly: true, value: prep.resolved.vendor.value })),
        h(Field, { label: "Model", ...field("model") },
          h("select", {
            id: "prep-model",
            value: model,
            onChange: (e: Event) => set("model", (e.target as HTMLSelectElement).value),
          }, modelChoices(prep, defaults.model, model).map((m) => h("option", { key: m, value: m }, m)))),
        h(Field, { label: "Provider", ...field("provider") },
          h("select", {
            id: "prep-provider",
            value: effective(defaults, edits, "provider"),
            onChange: (e: Event) => set("provider", (e.target as HTMLSelectElement).value),
          }, providerChoices(prep).map((p) => h("option", { key: p, value: p }, p)))),
      ),

      h(Section, { title: "Behaviour" },
        h(Field, { label: "Adversarial review", ...field("review") },
          // Switchable both ways since `--no-review` exists: it was locked on
          // while a review turned on by config could not be turned off for one
          // run, which is no longer true.
          h("select", {
            id: "prep-review",
            value: reviewOn ? "on" : "off",
            onChange: (e: Event) => set("review", (e.target as HTMLSelectElement).value === "on"),
          }, h("option", { value: "off" }, "Off"), h("option", { value: "on" }, "On"))),
        h(Field, {
          label: "Review model", ...field("reviewModel"),
          note: reviewOn ? null : "Enabled when review is on",
        },
          h("select", {
            id: "prep-reviewModel",
            value: reviewModel,
            disabled: !reviewOn,
            onChange: (e: Event) => set("reviewModel", (e.target as HTMLSelectElement).value),
          },
            // Vendor default is the built-in reviewer sent explicitly, so it can
            // override a configured reviewer; the other models follow.
            vendorDefault ? h("option", { key: "vendor-default", value: vendorDefault }, `Vendor default (${vendorDefault})`) : null,
            modelChoices(prep, reviewModel).filter((m) => m !== vendorDefault).map((m) => h("option", { key: m, value: m }, m)))),
        h(Field, { label: "Permission mode", ...field("permissionMode") },
          h("select", {
            id: "prep-permissionMode",
            value: effective(defaults, edits, "permissionMode"),
            onChange: (e: Event) => set("permissionMode", (e.target as HTMLSelectElement).value),
          }, permissionModes.map((m) => h("option", { key: m, value: m }, m || "Not set")))),
        h(Field, {
          label: "Full test gate", ...field("skipTestGate"),
        },
          // `--no-skip-test-gate` puts the gate back for one run, so a gate the
          // config or the task skips is no longer a one-way door.
          h("select", {
            id: "prep-skipTestGate",
            value: effective(defaults, edits, "skipTestGate") ? "skip" : "run",
            onChange: (e: Event) => set("skipTestGate", (e.target as HTMLSelectElement).value === "skip"),
          }, h("option", { value: "run" }, "Run"), h("option", { value: "skip" }, "Skip"))),
        h(Field, { label: "Session", ...field("fresh") },
          h("select", {
            id: "prep-fresh",
            value: effective(defaults, edits, "fresh") ? "fresh" : "reuse",
            disabled: defaults.fresh,
            onChange: (e: Event) => set("fresh", (e.target as HTMLSelectElement).value === "fresh"),
          }, h("option", { value: "reuse" }, "Reuse"), h("option", { value: "fresh" }, "Fresh"))),
        h(Field, { label: "Max turns", ...field("maxTurns"), note: turnsApply ? null : "api provider only" },
          h("input", {
            id: "prep-maxTurns",
            type: "number",
            min: 1,
            max: 500,
            disabled: !turnsApply,
            value: Number.isNaN(maxTurns) ? "" : String(maxTurns),
            onInput: (e: Event) => set("maxTurns", numberOf((e.target as HTMLInputElement).value)),
          })),
        h(Field, { label: "Token budget", ...field("tokenBudget"), note: "0 means unlimited" },
          h("input", {
            id: "prep-tokenBudget",
            type: "number",
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
            value: Number.isNaN(tokenBudget) ? "" : String(tokenBudget),
            onInput: (e: Event) => set("tokenBudget", numberOf((e.target as HTMLInputElement).value)),
          })),
        h(Field, { label: "Notes for the agent", ...field("contextNotes"), source: null },
          h("textarea", {
            id: "prep-contextNotes",
            rows: 3,
            value: effective(defaults, edits, "contextNotes"),
            onInput: (e: Event) => set("contextNotes", (e.target as HTMLTextAreaElement).value),
          })),
        h("details", { class: "prep-advanced" },
          h("summary", null, "Advanced"),
          h(Field, { label: "Allow dirty tree", ...field("allowDirty") },
            h("input", {
              id: "prep-allowDirty",
              type: "checkbox",
              checked: effective(defaults, edits, "allowDirty"),
              disabled: defaults.allowDirty,
              onChange: (e: Event) => set("allowDirty", (e.target as HTMLInputElement).checked),
            })),
        ),
      ),

      // Recommendation slot: `prep.recommendation` is null until per-task model
      // advice lands (a later phase), and a null renders nothing here.

      h(Section, { title: "Preflight" },
        h("ul", { class: "prep-preflight" },
          refusals.map((r) => h("li", { key: `${r.code}:${r.message}`, class: "prep-refusal" },
            h("span", { class: "prep-preflight-text" }, r.message),
            r.hint ? h("span", { class: "prep-hint" }, ` ${r.hint}`) : null,
            r.code === "tree-not-conformant" && r.migratable
              ? h("button", { type: "button", class: "prep-btn", onClick: props.onMigrate, disabled: busy }, "Migrate the PRD tree")
              : null,
          )),
          problem ? h("li", { class: "prep-refusal" }, problem.error) : null,
          warnings.map((w) => h("li", { key: w, class: "prep-warn" }, w)),
          admission ? h("li", { class: admission.queues ? "prep-warn" : "prep-ok" }, admission.text) : null,
          !blocked && warnings.length === 0 && !admission?.queues
            ? h("li", { class: "prep-ok" }, "Nothing stops this run")
            : null,
        ),
      ),

      h(Section, { title: "Command" },
        h("div", { class: "prep-command" },
          h("code", { class: "prep-command-line" }, command),
          h(CopyButton, { text: command }),
        ),
      ),

      execError ? h("p", { class: "prep-error", role: "alert" }, execError) : null,
      canMigrate
        ? h("button", { type: "button", class: "prep-btn", onClick: props.onMigrate, disabled: busy }, "Migrate the PRD tree")
        : null,
      notice ? h("p", { class: "prep-notice", role: "status" }, notice) : null,
      saveError ? h("p", { class: "prep-error", role: "alert" }, saveError) : null,
      conflict
        ? h("div", { class: "prep-conflict", role: "alert" },
          h("p", { class: "prep-conflict-text" },
            "These settings were saved elsewhere since you opened this."),
          h("div", { class: "prep-conflict-actions" },
            h("button", {
              type: "button", class: "prep-btn", onClick: props.onReloadConflict, disabled: busy,
            }, "Reload"),
            h("button", {
              type: "button", class: "prep-btn", onClick: props.onOverwriteConflict, disabled: busy,
            }, "Overwrite"),
          ),
        )
        : null,
      queued
        ? h(QueuedNotice, {
          reply: queued, taskId, onOpenLive: props.onOpenLive, liveHref: props.liveHref, onDropped: props.onQueueDropped,
        })
        : null,
    ),

    h("footer", { class: "prep-footer" },
      h("span", { class: "prep-change-count", role: "status" },
        // Two different facts: what this run does differently, and what the
        // task carries for every run including a terminal one.
        [
          `${changes} ${changes === 1 ? "change applies" : "changes apply"} to this run only`,
          ...(alreadySaved > 0
            ? [`${alreadySaved} saved, applies from the terminal too`]
            : []),
        ].join(" · "),
      ),
      offAnchor
        ? h("span", { class: "prep-off-anchor" },
          `Saved on branch ${prep.workspace.branch ?? "this worktree"}; lands when the branch merges`)
        : null,
      h("button", { type: "button", class: "prep-btn prep-preview-btn", onClick: props.onPreview }, "Preview brief"),
      confirmClear
        ? h(Fragment, null,
          h("span", { class: "prep-confirm-text", role: "status" },
            `Clear ${alreadySaved} saved ${alreadySaved === 1 ? "setting" : "settings"} for this task?`),
          h("button", {
            type: "button", class: "prep-btn", onClick: props.onClearSaved, disabled: busy,
          }, "Clear"),
          h("button", {
            type: "button", class: "prep-btn", onClick: () => setConfirmClear(false),
          }, "Keep"),
        )
        : h("button", {
          type: "button",
          class: "prep-btn",
          // With edits it clears them; with nothing but saved settings it asks
          // before touching what another session may rely on.
          onClick: () => (hasEdits ? setEdits({}) : setConfirmClear(true)),
          disabled: !hasEdits && alreadySaved === 0,
        }, "Reset to defaults"),
      h("button", {
        type: "button",
        class: "prep-btn",
        onClick: props.onSave,
        // Nothing to write when the block would come out identical to what is
        // stored: no edits, and nothing saved to clear.
        disabled: busy || (!hasEdits && alreadySaved === 0),
      }, busy ? "Saving…" : "Save"),
      h("button", {
        type: "button",
        class: "prep-btn prep-btn-primary",
        onClick: props.onExecute,
        disabled: blocked || busy || (queued !== null && !props.queueDropped),
      }, busy ? "Starting…" : resume ? "Resume" : "Execute"),
    ),
  );
}

function numberOf(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

function Section({ title, children }: { title: string; children?: ComponentChildren }) {
  return h("section", { class: "prep-section" },
    h("h3", { class: "prep-section-title" }, title),
    children,
  );
}

interface FieldProps {
  id: string;
  label: string;
  /** The resolve JSON's source for the default; null for a field with no default. */
  source: string | null;
  /** The value came from the task's own saved block, not the project's config. */
  saved?: boolean;
  /** What the project would have used instead; shown beside a saved value. */
  fallback?: { value: unknown; source: string } | null;
  changed: boolean;
  onReset: () => void;
  note?: string | null;
  children?: ComponentChildren;
}

/** A fallback value as the meta row prints it; `""` stands for "not set". */
function fallbackText(fallback: { value: unknown; source: string }): string {
  const shown = fallback.value === "" || fallback.value === null ? "not set" : String(fallback.value);
  return `project default: ${shown} from ${fallback.source}`;
}

/** A setting shown with its source but not editable per run (the vendor). */
function ReadOnlyField({ id, label, source, children }: { id: string; label: string; source: string; children?: ComponentChildren }) {
  return h("div", { class: "prep-field" },
    h("label", { for: id, class: "prep-label" }, label),
    h("div", { class: "prep-control" }, children),
    h("div", { class: "prep-field-meta" }, h("span", { class: "prep-source" }, `from ${source}`)),
  );
}

function Field({ id, label, source, saved, fallback, changed, onReset, note, children }: FieldProps) {
  // A saved field names the task rather than a config key: "from task.run.models"
  // would be true but says nothing a reader can act on, where "saved on task"
  // plus the project default it displaced is the whole decision.
  const sourceText = source === null ? null : saved ? "saved on task" : `from ${source}`;
  return h("div", { class: `prep-field${changed ? " prep-field--changed" : ""}${saved ? " prep-field--saved" : ""}` },
    h("label", { for: id, class: "prep-label" },
      changed ? h("span", { class: "prep-dot", "aria-hidden": "true" }, "●") : null,
      label,
    ),
    h("div", { class: "prep-control" }, children),
    h("div", { class: "prep-field-meta" },
      sourceText
        ? h("span", { class: `prep-source${saved ? " prep-source--saved" : ""}` }, sourceText)
        : null,
      saved && fallback ? h("span", { class: "prep-fallback" }, fallbackText(fallback)) : null,
      changed ? h("span", { class: "prep-changed" }, "changed for this run") : null,
      changed
        ? h("button", { type: "button", class: "prep-reset", onClick: onReset, "aria-label": `Reset ${label}` }, "Reset")
        : null,
      note ? h("span", { class: "prep-note" }, note) : null,
    ),
  );
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard refused (permissions, insecure context): say so; the command stays selectable.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }, [text]);
  return h("button", { type: "button", class: "prep-btn", onClick: copy, "aria-label": "Copy the command" },
    state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select it" : "Copy");
}

function PreviewPanel({ preview, onBack }: {
  preview: { brief: string | null; error: string | null; loading: boolean };
  onBack: () => void;
}) {
  return h(Fragment, null,
    h("div", { class: "prep-body" },
      h("h3", { class: "prep-section-title prep-preview-title", tabIndex: -1 }, "Brief preview"),
      preview.loading ? h("p", { class: "prep-loading", role: "status" }, "Building the brief…") : null,
      preview.error ? h("p", { class: "prep-error", role: "alert" }, preview.error) : null,
      preview.brief !== null
        ? h("pre", { class: "prep-brief", tabIndex: 0, "aria-label": "Brief preview" }, preview.brief)
        : null,
    ),
    h("footer", { class: "prep-footer" },
      h("button", { type: "button", class: "prep-btn", onClick: onBack }, "Back"),
    ),
  );
}
