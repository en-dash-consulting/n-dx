/**
 * Prompt Verbosity view — configure compact vs. verbose prompt style.
 *
 * Surfaces the `prompts.verbosity` setting from `.n-dx.json` as a
 * compact/verbose toggle. Verbose mode renders a token-cost warning callout
 * because it increases per-run token usage by 20–40% compared to the compact
 * default. Compact is visually marked as the recommended default.
 *
 * Data comes from GET /api/prompts/verbosity (read) and
 * PUT /api/prompts/verbosity (write).
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { NdxLogoPng } from "../components/logos.js";

// ── Types ─────────────────────────────────────────────────────────────

export type PromptVerbosity = "compact" | "verbose";

export interface PromptVerbosityResponse {
  verbosity: PromptVerbosity;
  defaultVerbosity: PromptVerbosity;
}

// ── Constants ─────────────────────────────────────────────────────────

/** Warning text shown when verbose mode is selected. Exported for tests. */
export const VERBOSE_WARNING_TEXT =
  "Verbose prompts use 20–40% more tokens per run than compact. " +
  "Compact is recommended for cost control.";

/** Description for compact mode. */
export const COMPACT_DESCRIPTION =
  "Concise prompts with essential context only. " +
  "Minimises token usage while preserving full task fidelity.";

/** Description for verbose mode. */
export const VERBOSE_DESCRIPTION =
  "Extended prompts with additional guidance sections, examples, and constraints. " +
  "Useful when the agent needs more context but increases token usage.";

// ── Verbosity option button ──────────────────────────────────────────

interface VerbosityOptionProps {
  value: PromptVerbosity;
  selected: boolean;
  onSelect: (value: PromptVerbosity) => void;
  saving: boolean;
}

function VerbosityOption({ value, selected, onSelect, saving }: VerbosityOptionProps) {
  const isCompact = value === "compact";
  const label = isCompact ? "Compact" : "Verbose";
  const description = isCompact ? COMPACT_DESCRIPTION : VERBOSE_DESCRIPTION;

  const handleClick = useCallback(() => {
    if (!saving) onSelect(value);
  }, [value, onSelect, saving]);

  return h("button", {
    class: `pv-option${selected ? " pv-option-selected" : ""}${saving ? " pv-option-disabled" : ""}`,
    type: "button",
    onClick: handleClick,
    disabled: saving,
    "aria-pressed": String(selected),
    "data-value": value,
  },
    h("div", { class: "pv-option-header" },
      h("span", { class: "pv-option-label" }, label),
      isCompact
        ? h("span", { class: "pv-option-recommended" }, "recommended")
        : null,
      selected
        ? h("span", { class: "pv-option-active-badge" }, saving ? "Saving…" : "Active")
        : null,
    ),
    h("p", { class: "pv-option-desc" }, description),
  );
}

// ── Token-cost warning callout ────────────────────────────────────────

function VerboseWarningCallout() {
  return h("div", { class: "pv-verbose-warning", role: "alert", "aria-live": "polite" },
    h("span", { class: "pv-verbose-warning-icon", "aria-hidden": "true" }, "\u26A0"),
    h("div", { class: "pv-verbose-warning-body" },
      h("strong", null, "Token cost warning"),
      h("p", null, VERBOSE_WARNING_TEXT),
      h("p", null,
        "To revert: ",
        h("code", null, "ndx config prompts.verbosity compact"),
      ),
    ),
  );
}

// ── Main view ────────────────────────────────────────────────────────

export function PromptVerbosityView() {
  const [verbosity, setVerbosity] = useState<PromptVerbosity>("compact");
  const [defaultVerbosity, setDefaultVerbosity] = useState<PromptVerbosity>("compact");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/prompts/verbosity")
      .then((res) => res.json() as Promise<PromptVerbosityResponse>)
      .then((data) => {
        setVerbosity(data.verbosity);
        setDefaultVerbosity(data.defaultVerbosity);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load verbosity setting");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = useCallback(async (value: PromptVerbosity) => {
    if (value === verbosity || saving) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/prompts/verbosity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verbosity: value }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setError((body as { error?: string }).error ?? "Failed to save verbosity");
        return;
      }

      const updated = await res.json() as PromptVerbosityResponse;
      setVerbosity(updated.verbosity);
      setToast(`Verbosity set to ${updated.verbosity}`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save verbosity");
    } finally {
      setSaving(false);
    }
  }, [verbosity, saving]);

  const isModified = verbosity !== defaultVerbosity;

  if (loading) {
    return h("div", { class: "pv-container" },
      h("div", { class: "loading" }, "Loading verbosity setting…"),
    );
  }

  return h("div", { class: "pv-container" },

    // Header
    h("div", { class: "pv-header" },
      h("div", { class: "pv-header-brand" },
        h(NdxLogoPng, { size: 16, class: "pv-header-logo" }),
        h("span", { class: "pv-header-title" }, "Prompt Verbosity"),
      ),
      h("p", { class: "pv-header-subtitle" },
        "Controls how much context is included in each LLM prompt. " +
        "Compact is the default and recommended for most projects.",
      ),
    ),

    // Status row
    isModified
      ? h("div", { class: "pv-status-row" },
          h("span", { class: "pv-badge pv-badge-modified" }, "modified from default"),
        )
      : null,

    // Error banner
    error
      ? h("div", { class: "pv-error-banner", role: "alert" }, error)
      : null,

    // Toast
    toast
      ? h("div", { class: "pv-toast", role: "status", "aria-live": "polite" },
          h("span", { class: "pv-toast-icon" }, "\u2714"),
          h("span", null, toast),
        )
      : null,

    // Option buttons
    h("div", { class: "pv-options" },
      h(VerbosityOption, {
        value: "compact",
        selected: verbosity === "compact",
        onSelect: handleSelect,
        saving,
      }),
      h(VerbosityOption, {
        value: "verbose",
        selected: verbosity === "verbose",
        onSelect: handleSelect,
        saving,
      }),
    ),

    // Verbose warning callout (shown only when verbose is active)
    verbosity === "verbose"
      ? h(VerboseWarningCallout, null)
      : null,
  );
}
