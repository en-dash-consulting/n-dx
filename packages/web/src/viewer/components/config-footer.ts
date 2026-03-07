/**
 * Configuration display footer for the sidebar.
 *
 * Shows active n-dx configuration (model, auth method, token budget) in a
 * collapsible panel above the sidebar footer controls.
 */

import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";

// ---------------------------------------------------------------------------
// Types (mirror server-side shapes)
// ---------------------------------------------------------------------------

interface NdxConfigSummary {
  model: string | null;
  provider: string | null;
  authMethod: "api-key" | "cli" | "none";
  tokenBudget: number | null;
  maxTurns: number | null;
  projectDir: string;
  projectName: string;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

const CONFIG_POLL_INTERVAL_MS = 30_000;

function useNdxConfig(): NdxConfigSummary | null {
  const [config, setConfig] = useState<NdxConfigSummary | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/ndx-config");
        if (!res.ok) return;
        const data: NdxConfigSummary = await res.json();
        if (mountedRef.current) setConfig(data);
      } catch {
        // ignore
      }
    };

    fetchConfig();
    const timer = setInterval(fetchConfig, CONFIG_POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);

  return config;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatModel(model: string | null): string {
  if (!model) return "default";
  // Shorten full model IDs for display
  if (model.startsWith("claude-")) {
    const parts = model.split("-");
    // "claude-sonnet-4-6" -> "sonnet 4"
    if (parts.length >= 3) {
      return `${parts[1]} ${parts[2]}`;
    }
  }
  return model;
}

function formatTokenBudget(budget: number | null): string {
  if (budget === null || budget === 0) return "unlimited";
  if (budget >= 1_000_000) return `${(budget / 1_000_000).toFixed(1)}M`;
  if (budget >= 1_000) return `${Math.round(budget / 1_000)}K`;
  return String(budget);
}

const AUTH_LABELS: Record<string, string> = {
  "api-key": "API Key",
  "cli": "Claude CLI",
  "none": "Not configured",
};

const AUTH_ICONS: Record<string, string> = {
  "api-key": "\u{1F511}",
  "cli": "\u{1F4BB}",
  "none": "\u26A0",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfigFooter() {
  const config = useNdxConfig();
  const [expanded, setExpanded] = useState(false);

  if (!config) return null;

  return h("div", {
    class: `config-footer${expanded ? " config-footer-expanded" : ""}`,
    role: "region",
    "aria-label": "Project configuration",
  },
    // Toggle bar — always visible
    h("button", {
      class: "config-footer-toggle",
      onClick: () => setExpanded(!expanded),
      "aria-expanded": String(expanded),
      "aria-controls": "config-footer-details",
      title: expanded ? "Collapse configuration" : "Show configuration",
    },
      h("span", { class: "config-footer-summary" },
        // Model badge
        h("span", {
          class: "config-badge config-badge-model",
          title: `Model: ${config.model ?? "default"}`,
        }, formatModel(config.model)),
        // Auth indicator
        h("span", {
          class: `config-badge config-badge-auth config-badge-auth-${config.authMethod}`,
          title: `Auth: ${AUTH_LABELS[config.authMethod]}`,
        }, AUTH_ICONS[config.authMethod]),
      ),
      h("svg", {
        class: `config-footer-chevron${expanded ? " config-footer-chevron-open" : ""}`,
        width: 10,
        height: 10,
        viewBox: "0 0 12 12",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
        "aria-hidden": "true",
      }, h("path", { d: "M3 8.5l3-3 3 3" })),
    ),

    // Expandable detail panel
    expanded
      ? h("div", {
          id: "config-footer-details",
          class: "config-footer-details",
          role: "group",
          "aria-label": "Configuration details",
        },
          // Config rows
          h("div", { class: "config-row" },
            h("span", { class: "config-label" }, "Model"),
            h("span", { class: "config-value" }, formatModel(config.model)),
          ),
          h("div", { class: "config-row" },
            h("span", { class: "config-label" }, "Auth"),
            h("span", { class: "config-value" }, AUTH_LABELS[config.authMethod]),
          ),
          config.provider
            ? h("div", { class: "config-row" },
                h("span", { class: "config-label" }, "Provider"),
                h("span", { class: "config-value" }, config.provider),
              )
            : null,
          h("div", { class: "config-row" },
            h("span", { class: "config-label" }, "Budget"),
            h("span", { class: "config-value" }, formatTokenBudget(config.tokenBudget)),
          ),
          config.maxTurns
            ? h("div", { class: "config-row" },
                h("span", { class: "config-label" }, "Max turns"),
                h("span", { class: "config-value" }, String(config.maxTurns)),
              )
            : null,
        )
      : null,
  );
}
