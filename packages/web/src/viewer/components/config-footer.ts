/**
 * Configuration display footer for the sidebar.
 *
 * Two things, stacked. An identity line — which n-dx is running, from where,
 * and which directory it is serving — and below it the collapsible panel of
 * active configuration (model, auth method, token budget).
 *
 * The identity line answers the question a second dashboard makes urgent:
 * with several checkouts open, or a globally installed n-dx next to a
 * development one, "which of them am I looking at?" is not guessable from
 * the page. It comes from `GET /api/config`'s `server` object, which
 * main.ts already fetches before the first render — passed down as a prop
 * rather than fetched again here. A server too old to send it renders no
 * identity line at all, which is the honest answer: an unknown version is
 * worse than none.
 */

import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";

// ---------------------------------------------------------------------------
// Types (mirror server-side shapes)
// ---------------------------------------------------------------------------

/**
 * The subset of the server's `ServerInfo` (see server/routes-status.ts) that
 * the footer shows. Structural, not imported: the viewer never imports from
 * the server half of the package.
 */
export interface ServerIdentity {
  version: string;
  /** Absolute path of the CLI that launched this server; may be empty. */
  cliPath: string;
  /** Absolute path of the directory this server serves. */
  projectDir: string;
}

interface NdxConfigSummary {
  vendor: string | null;
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
// Identity line
// ---------------------------------------------------------------------------

/** Last path segment, for either separator. Empty string for an empty path. */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  if (!trimmed) return "";
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

function dirname(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut <= 0 ? "" : trimmed.slice(0, cut);
}

/**
 * The install `cliPath` came from, as one short label.
 *
 * `cliPath` points at the entry file, which sits at a known depth inside the
 * install: `<checkout>/packages/core/cli.js` in a monorepo, `<pkg>/dist/cli/
 * index.js` in a build, `<pkg>/bin/ndx.js` when published. Climbing past
 * those leaves the root, and the root's own name is what identifies it —
 * "n-dx", "n-dx-internal", "core". A scoped package keeps its scope
 * ("@n-dx/core"), which is the whole difference between two installs that
 * would otherwise both read "core".
 *
 * Returns null when there is nothing useful to show; the caller omits the
 * segment rather than printing a placeholder.
 */
export function installRootLabel(cliPath: string): string | null {
  if (!cliPath) return null;
  let dir = dirname(cliPath);
  if (!dir) return null;

  // Climb the wrapper directories the entry file lives in. Empty segments are
  // dropped first: a doubled or trailing separator would otherwise shift the
  // tail by one and leave the label reading "core" instead of the install.
  const segments = dir.split(/[/\\]+/).filter(Boolean);
  const wrappers = [["packages", "core"], ["dist", "cli"], ["src", "cli"], ["bin"], ["dist"]];
  for (const wrapper of wrappers) {
    const tail = segments.slice(-wrapper.length).map((seg) => seg.toLowerCase());
    if (tail.length === wrapper.length && tail.every((seg, i) => seg === wrapper[i])) {
      dir = segments.slice(0, -wrapper.length).join("/");
      break;
    }
  }
  const name = basename(dir);
  if (!name) return null;
  const parent = basename(dirname(dir));
  return parent.startsWith("@") ? `${parent}/${name}` : name;
}

/**
 * The identity line's text: "n-dx 0.6.0 · n-dx · my-project". Segments that
 * are unknown drop out rather than showing an empty separator.
 */
export function identityLine(server: ServerIdentity): string {
  const parts = [`n-dx ${server.version || "unknown"}`];
  const install = installRootLabel(server.cliPath);
  if (install) parts.push(install);
  const project = basename(server.projectDir);
  if (project) parts.push(project);
  return parts.join(" \u00B7 ");
}

/** The tooltip: the full paths the line shortened, one per line. */
export function identityTooltip(server: ServerIdentity): string {
  const lines = [`n-dx ${server.version || "unknown"}`];
  if (server.cliPath) lines.push(`CLI: ${server.cliPath}`);
  if (server.projectDir) lines.push(`Project: ${server.projectDir}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatModel(model: string | null, vendor: string | null): string {
  if (!model) return "default";
  // Shorten official claude model IDs: "claude-sonnet-4-6" → "sonnet 4"
  if (model.startsWith("claude-")) {
    const parts = model.split("-");
    if (parts.length >= 3) return `${parts[1]} ${parts[2]}`;
  }
  // Truncate long local model IDs (path-style names from LM Studio / Ollama)
  if (model.length > 22) {
    // Keep the tail — it usually has the most distinctive part (e.g. model variant)
    return "…" + model.slice(-20);
  }
  return model;
}

/** Short vendor label for the badge (blank for claude — already implied by model name). */
const DISPLAY_VENDOR = {
  CLAUDE: "claude",
  CODEX: "codex",
  LOCAL: "local",
} as const;

function vendorPrefix(vendor: string | null): string {
  if (!vendor || vendor === DISPLAY_VENDOR.CLAUDE) return "";
  if (vendor === DISPLAY_VENDOR.CODEX) return "codex · ";
  if (vendor === DISPLAY_VENDOR.LOCAL) return "local · ";
  return `${vendor} · `;
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

export interface ConfigFooterProps {
  /**
   * Server identity from `GET /api/config`, threaded down from main.ts.
   * Absent on a server too old to send it (and in a static export, which has
   * no server at all) — the identity line is then omitted.
   */
  server?: ServerIdentity | null;
}

export function ConfigFooter({ server = null }: ConfigFooterProps = {}) {
  const config = useNdxConfig();
  const [expanded, setExpanded] = useState(false);

  // The identity line does not wait for /api/ndx-config: it has everything it
  // needs from the prop, and a footer that appears a second late is a footer
  // that is missing exactly when someone is checking which window is which.
  if (!config && !server) return null;

  const identity = server
    ? h("div", {
        class: "config-footer-identity",
        title: identityTooltip(server),
      }, identityLine(server))
    : null;

  if (!config) {
    return h("div", {
      class: "config-footer",
      role: "region",
      "aria-label": "Server identity",
    }, identity);
  }

  return h("div", {
    class: `config-footer${expanded ? " config-footer-expanded" : ""}`,
    role: "region",
    "aria-label": "Project configuration",
  },
    identity,
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
          title: `Vendor: ${config.vendor ?? "default"}  Model: ${config.model ?? "default"}`,
        }, vendorPrefix(config.vendor) + formatModel(config.model, config.vendor)),
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
          config.vendor
            ? h("div", { class: "config-row" },
                h("span", { class: "config-label" }, "Vendor"),
                h("span", { class: "config-value" }, config.vendor),
              )
            : null,
          h("div", { class: "config-row" },
            h("span", { class: "config-label" }, "Model"),
            h("span", { class: "config-value" }, config.model ?? "default"),
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
