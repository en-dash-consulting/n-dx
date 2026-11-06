/**
 * Your tooling — the Tune tile. A read-only summary of what this project can
 * run on: each vendor CLI's state, the model per tier, per-command route
 * overrides and review pairing. Every line links to the Settings page that
 * changes it; the tile has no control of its own.
 */

import { h } from "preact";
import type { ComponentChild, ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { appUrl } from "../base-path.js";
import { useCliName } from "../hooks/index.js";
import { viewPathname } from "../route-state.js";
import type { NavigateTo } from "../types.js";
import { ROBOT_WRANGLER_SECTIONS, type RobotWranglerSection } from "./robot-wrangler-sections.js";
import {
  summarizeTooling,
  type ToolingAuth,
  type ToolingCatalog,
  type ToolingConfig,
  type ToolingState,
} from "./tooling-summary.js";

const STATE_LABEL: Record<ToolingState, string> = {
  connected: "Connected",
  "signed-out": "Signed out",
  missing: "Missing",
  unknown: "Status unavailable",
};

const TIER_LABEL: Record<string, string> = { light: "Light", standard: "Standard", heavy: "Heavy" };

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; config: ToolingConfig; catalog: ToolingCatalog | null; auth: ToolingAuth };

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    return res.ok ? await res.json() as T : null;
  } catch {
    return null;
  }
}

/**
 * The verdict of the last credential check Robot Wrangler ran; only the active
 * CLI vendor has one. Reads the server's cache and never starts a check — the
 * live check runs the vendor CLI on a real prompt, so it stays on Robot
 * Wrangler's Re-check. No cached verdict reads as null (catalog state only).
 */
async function readCachedAuth(config: ToolingConfig): Promise<ToolingAuth> {
  if (config.effective?.provider !== "cli") return null;
  const body = await getJson<{ cached?: boolean; ok?: boolean; error?: string | null }>(
    "/api/commands/auth/cached",
  );
  if (!body?.cached) return null;
  return body.ok
    ? { ok: true, detail: null }
    : { ok: false, detail: body.error ?? "Credential check failed" };
}

/** A link to the Robot Wrangler section that edits the line it labels. */
function SettingsLink({ section, navigateTo, children }: {
  section: RobotWranglerSection;
  navigateTo: NavigateTo;
  children?: ComponentChildren;
}): ComponentChild {
  return h("a", {
    class: "tooling-link",
    "data-section": section,
    href: appUrl(`${viewPathname("robot-wrangler", null)}?${new URLSearchParams({ section })}`),
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigateTo("robot-wrangler", { section });
    },
  }, children);
}

export function ToolingPanel({ navigateTo, extra }: {
  navigateTo: NavigateTo;
  /** Where S8's Sidecar and connections lines join the tile. */
  extra?: ComponentChild;
}): ComponentChild {
  const cliName = useCliName();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [config, catalog] = await Promise.all([
        getJson<ToolingConfig>("/api/llm/config"),
        getJson<ToolingCatalog>("/api/llm/catalog"),
      ]);
      if (cancelled) return;
      if (!config) { setLoad({ state: "error" }); return; }
      // Render from config and catalog now; the auth line fills in after.
      setLoad({ state: "ready", config, catalog, auth: null });
      const auth = await readCachedAuth(config);
      if (!cancelled && auth) setLoad({ state: "ready", config, catalog, auth });
    })();
    return () => { cancelled = true; };
  }, []);

  const summary = useMemo(
    () => (load.state === "ready" ? summarizeTooling(load.config, load.catalog, load.auth) : null),
    [load],
  );

  if (load.state === "loading") return h("p", { class: "stage-tile-empty" }, "Loading…");
  if (!summary) return h("p", { class: "stage-tile-empty" }, "Could not read the project's LLM configuration.");

  return h("div", { class: "tooling-panel" },
    h("ul", { class: "tooling-vendors", "aria-label": "Vendors" },
      summary.vendors.map((vendor) => h("li", { key: vendor.id, class: "tooling-vendor", "data-vendor": vendor.id },
        h("div", { class: "tooling-vendor-head" },
          h(SettingsLink, { section: "models", navigateTo }, vendor.label),
          h("span", {
            class: `tooling-state tooling-state--${vendor.state}`,
            title: vendor.detail,
          }, STATE_LABEL[vendor.state]),
          vendor.active ? h("span", { class: "tooling-active" }, "active") : null),
        h("dl", { class: "tooling-tiers" },
          vendor.tiers.map((row) => h("div", { key: row.tier, class: "tooling-tier", "data-tier": row.tier },
            h("dt", null, TIER_LABEL[row.tier] ?? row.tier),
            h("dd", null, h("code", null, row.model)))))))),
    h("p", { class: "tooling-line tooling-routes" },
      // No Settings field edits llm.routes; the CLI's `config` command does.
      summary.routes.length === 0
        ? "No per-command route overrides"
        : `Route overrides: ${summary.routes.map((r) => `${r.label} → ${TIER_LABEL[r.tier] ?? r.tier}`).join(", ")}`,
      " (change with ", h("code", null, `${cliName} config`), ")"),
    h("p", { class: "tooling-line tooling-review" },
      h(SettingsLink, { section: "review", navigateTo }, summary.review)),
    // Reserved for S8: the Sidecar's settings and C1's connections.
    h("div", { class: "tooling-extra", "data-slot": "sidecar-connections" }, extra ?? null));
}
