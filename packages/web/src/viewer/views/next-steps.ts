/**
 * Next steps: the prioritized recommendations `/api/sv/next-steps` derives
 * from the zone findings (the UI twin of the MCP `get_next_steps` tool), and
 * the copy and capture-to-PRD helpers the Overview's NextStepsPanel and the
 * Analyze dashboard's health list share.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { errorMessage } from "../utils/format.js";

// ── Next steps ─────────────────────────────────────────────────

export interface NextStep {
  priority: string;
  title: string;
  description: string;
  category: string;
  /** Indices into the zone findings this step groups. */
  relatedFindings?: number[];
  /** The zone the step is about, or "global". */
  scope?: string;
}

/** Copy text to the clipboard with a legacy execCommand fallback. */
export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/** Format the full step list as a numbered markdown list. */
export function stepsToMarkdown(steps: readonly NextStep[]): string {
  return steps
    .map((s, i) => `${i + 1}. **[${s.priority}]** ${s.title} — ${s.description}`)
    .join("\n");
}

/**
 * The top next steps, or null while loading, when there are none, and when the
 * request fails — the list is best-effort and shows the findings without them.
 */
export function useNextSteps(limit = 5): NextStep[] | null {
  const [steps, setSteps] = useState<NextStep[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sv/next-steps?limit=${limit}`);
        if (!res.ok) return;
        const body = await res.json() as { steps?: NextStep[] };
        if (!cancelled && body.steps && body.steps.length > 0) setSteps(body.steps);
      } catch {
        // Best-effort — stay without steps on failure
      }
    })();
    return () => { cancelled = true; };
  }, [limit]);
  return steps;
}

/**
 * "Capture to PRD" with its confirm step: files the steps as PRD items via
 * POST /api/rex/capture-next-steps and reports what was created.
 */
export function NextStepsCapture({ steps }: { steps: readonly NextStep[] }): ComponentChild {
  const [capture, setCapture] = useState<"idle" | "confirm" | "capturing" | "done" | "error">("idle");
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);

  const handleCapture = useCallback(async () => {
    setCapture("capturing");
    setCaptureMsg(null);
    try {
      const res = await fetch("/api/rex/capture-next-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps }),
      });
      const body = await res.json().catch(() => ({})) as { created?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const created = body.created ?? 0;
      const skipped = body.skipped ?? 0;
      setCaptureMsg(
        `✓ Captured ${created} to PRD` +
        (skipped > 0 ? ` (${skipped} duplicate${skipped === 1 ? "" : "s"} skipped)` : ""),
      );
      setCapture("done");
    } catch (err) {
      setCaptureMsg(errorMessage(err));
      setCapture("error");
    }
  }, [steps]);

  return h("div", { class: "next-steps-footer" },
    capture === "idle" || capture === "done" || capture === "error"
      ? h("button", {
          class: "cmd-inline-trigger next-steps-capture-btn",
          onClick: () => { setCapture("confirm"); setCaptureMsg(null); },
          title: "File these recommendations as PRD items so they can be worked on",
          type: "button",
        },
          h("span", { "aria-hidden": "true" }, "\u{1F4CB}"),
          "Capture to PRD",
        )
      : null,
    capture === "confirm"
      ? h("span", { class: "next-steps-confirm" },
          `Capture ${steps.length} finding${steps.length === 1 ? "" : "s"} into the PRD?`,
          h("button", {
            class: "cmd-inline-trigger next-steps-confirm-btn",
            onClick: handleCapture,
            type: "button",
          }, "Confirm"),
          h("button", {
            class: "cmd-inline-trigger next-steps-cancel-btn",
            onClick: () => setCapture("idle"),
            type: "button",
          }, "Cancel"),
        )
      : null,
    capture === "capturing"
      ? h("span", { class: "next-steps-confirm", "aria-busy": "true" },
          h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }),
          "Capturing...",
        )
      : null,
    h("span", { role: "status", "aria-live": "polite" },
      capture === "done" && captureMsg
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" }, captureMsg)
        : null,
    ),
    capture === "error" && captureMsg
      ? h("span", { class: "cmd-inline-result cmd-inline-result-err", role: "alert" }, captureMsg)
      : null,
  );
}

