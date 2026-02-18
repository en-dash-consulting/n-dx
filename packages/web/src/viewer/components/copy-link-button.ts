/**
 * CopyLinkButton — reusable component for generating and copying shareable deep-links.
 *
 * Builds a full URL from the current origin + the provided path, copies it to
 * the clipboard, and shows brief visual feedback ("Copied!").
 *
 * Used across:
 * - PRD item detail panels (task, feature, epic, subtask)
 * - Hench run detail views
 * - RexTaskLink context menus
 */

import { h } from "preact";
import { useState, useCallback, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

export interface CopyLinkButtonProps {
  /** Path portion of the shareable URL, e.g. "/prd/abc123" or "/hench-runs/xyz". */
  path: string;
  /** Optional CSS class to add. */
  class?: string;
  /** Label text. Default: "Copy Link" */
  label?: string;
  /** Compact variant — smaller text, icon-only on narrow screens. Default: false */
  compact?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a full shareable URL from a path. Uses the current origin. */
export function buildShareableUrl(path: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

// ── Component ────────────────────────────────────────────────────────

export function CopyLinkButton({
  path,
  class: className,
  label = "Copy Link",
  compact = false,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const url = buildShareableUrl(path);

    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: select text in a temporary input
      try {
        const input = document.createElement("input");
        input.value = url;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        // Silent fail
      }
    });
  }, [path]);

  const classes = [
    "copy-link-btn",
    compact ? "copy-link-btn-compact" : "",
    copied ? "copy-link-btn-copied" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return h("button", {
    class: classes,
    onClick: handleClick,
    title: copied ? "Copied!" : `Copy shareable link`,
    "aria-label": copied ? "Link copied to clipboard" : label,
    type: "button",
  },
    // Link icon
    h("span", { class: "copy-link-icon", "aria-hidden": "true" },
      copied ? "\u2713" : "\ud83d\udd17",
    ),
    // Label (hidden in compact mode via CSS)
    h("span", { class: "copy-link-label" },
      copied ? "Copied!" : label,
    ),
  );
}
