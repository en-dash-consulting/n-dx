/**
 * Assistant-neutral setup orchestration — provisions supported assistant
 * surfaces (Claude, Codex) without coupling the init flow to any
 * single vendor.
 *
 * cli.js delegates to `setupAssistantIntegrations()` during init, which
 * dispatches to vendor-specific integrations via a registry.  Adding a
 * new vendor is a matter of adding an entry to `VENDOR_REGISTRY` and a
 * corresponding `<vendor>-integration.js` module — no changes to the
 * init control flow are required.
 *
 * @module n-dx/assistant-integration
 */

import { setupClaudeIntegration } from "./claude-integration.js";
import { setupCodexIntegration } from "./codex-integration.js";

// ── Vendor registry ──────────────────────────────────────────────────────────

/**
 * Each entry maps a vendor name to its setup function and a one-line
 * summary formatter.  The registry is the single place where vendor
 * dispatch is defined — handleInit() never mentions vendor names
 * directly (except to build the options object from CLI flags).
 */
const VENDOR_REGISTRY = {
  claude: {
    label: "Claude Code",
    skipFlag: "--no-claude",
    setup: setupClaudeIntegration,
    summarize: (r) =>
      `CLAUDE.md, ${r.skills.written} skills, ${r.settings.total} permissions`,
  },
  codex: {
    label: "Codex",
    skipFlag: "--no-codex",
    setup: setupCodexIntegration,
    summarize: (r) =>
      `AGENTS.md, ${r.skills.written} skills, ${r.config.serverCount} MCP servers`,
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the list of vendor names known to the registry.
 *
 * @returns {string[]}
 */
export function getSupportedAssistants() {
  return Object.keys(VENDOR_REGISTRY);
}

/**
 * Provision all enabled assistant surfaces in a single call.
 *
 * Each vendor is set up independently — a failure in one does not
 * prevent the other from completing.  Failures are captured as
 * `"skipped"` summaries rather than thrown.
 *
 * @param {string} dir  Project root directory
 * @param {Record<string, boolean>} [enabled]
 *   Map of vendor names to enabled flags.  Vendors not present default
 *   to `true` (enabled).  Pass `{ claude: false }` to skip Claude, etc.
 * @returns {Record<string, { summary: string, detail?: object }>}
 *   Per-vendor result keyed by vendor name.
 */
export function setupAssistantIntegrations(dir, enabled = {}) {
  const results = {};

  for (const [vendor, entry] of Object.entries(VENDOR_REGISTRY)) {
    const isEnabled = enabled[vendor] !== false;

    if (!isEnabled) {
      results[vendor] = {
        summary: `skipped (${entry.skipFlag})`,
        label: entry.label,
        skipped: true,
      };
      continue;
    }

    try {
      const detail = entry.setup(dir);
      results[vendor] = {
        summary: entry.summarize(detail),
        label: entry.label,
        detail,
        skipped: false,
      };
    } catch (e) {
      results[vendor] = {
        summary: "skipped (setup failed)",
        label: entry.label,
        skipped: true,
        error: e.message || String(e),
      };
    }
  }

  return results;
}

/**
 * Format the assistant provisioning section for the init summary.
 *
 * Returns an array of pre-formatted lines ready for console output.
 * Each line is indented to align with the init summary's 2-space
 * indent convention.
 *
 * When `verbose` is true (default), the report includes per-artifact
 * detail lines beneath each vendor — making it obvious which files
 * were written and which capabilities were provisioned.
 *
 * @param {Record<string, { summary: string, label: string, skipped?: boolean, detail?: object }>} results
 *   The return value of `setupAssistantIntegrations()`.
 * @param {{ verbose?: boolean, activeVendor?: string }} [opts]
 *   `activeVendor` — the LLM vendor the user selected (e.g. "claude").
 *   When set, non-active vendors are shown in compact single-line form
 *   even in verbose mode, keeping the summary focused on the chosen
 *   assistant surface.
 * @returns {string[]}
 */
export function formatInitReport(results, opts = {}) {
  const verbose = opts.verbose !== false;
  const activeVendor = opts.activeVendor;
  const lines = ["  Assistant surfaces:"];

  for (const [vendor, result] of Object.entries(results)) {
    const label = (result.label ?? "unknown").padEnd(14);

    // De-emphasize non-active vendors: compact single-line even in verbose mode.
    const isNonActive = activeVendor && vendor !== activeVendor;

    if (result.skipped || !verbose || !result.detail || isNonActive) {
      // Compact single-line form (skipped vendors, non-verbose mode, or non-active vendor)
      lines.push(`    ${label}${result.summary}`);
      if (result.error) {
        lines.push(`      reason: ${result.error}`);
      }
      continue;
    }

    // Verbose per-artifact breakdown
    lines.push(`    ${label}${result.summary}`);
    const artifacts = formatVendorArtifacts(vendor, result.detail);
    for (const line of artifacts) {
      lines.push(`      ${line}`);
    }
  }

  return lines;
}

/**
 * Build per-artifact detail lines for a provisioned vendor.
 *
 * Each vendor setup function returns a different detail shape.
 * This function maps known shapes to human-readable artifact lines.
 *
 * @param {string} vendor
 * @param {object} detail
 * @returns {string[]}
 */
function formatVendorArtifacts(vendor, detail) {
  const lines = [];

  if (vendor === "claude") {
    if (detail.instructions?.written) {
      lines.push("CLAUDE.md written");
    }
    if (detail.skills) {
      lines.push(`.claude/skills/ — ${detail.skills.written} skill${detail.skills.written === 1 ? "" : "s"}`);
    }
    if (detail.settings) {
      lines.push(`.claude/settings — ${detail.settings.added} new permission${detail.settings.added === 1 ? "" : "s"} (${detail.settings.total} total)`);
    }
    if (detail.mcp) {
      if (!detail.mcp.registered) {
        lines.push(`MCP servers — skipped (${detail.mcp.reason})`);
      } else if (detail.mcp.servers) {
        const ok = detail.mcp.servers.filter((s) => s.ok);
        const failed = detail.mcp.servers.filter((s) => !s.ok);
        if (ok.length > 0) {
          lines.push(`MCP servers — ${ok.map((s) => s.name).join(", ")} (${ok[0].transport})`);
        }
        if (failed.length > 0) {
          const failDetail = failed
            .map((s) => (s.error ? `${s.name} (${s.error})` : s.name))
            .join(", ");
          lines.push(`MCP servers — failed: ${failDetail}`);
        }
      }
    }
  }

  if (vendor === "codex") {
    if (detail.agents?.written) {
      lines.push("AGENTS.md written");
    }
    if (detail.skills) {
      lines.push(`.agents/skills/ — ${detail.skills.written} skill${detail.skills.written === 1 ? "" : "s"}`);
    }
    if (detail.config?.written) {
      lines.push(`.codex/config.toml — ${detail.config.serverCount} MCP server${detail.config.serverCount === 1 ? "" : "s"} (stdio)`);
    }
  }

  return lines;
}
