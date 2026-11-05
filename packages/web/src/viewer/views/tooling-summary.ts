/**
 * Your tooling — what the project can run on, from the config and catalog the
 * Settings pages already read. Pure: the panel fetches, this shapes. Nothing
 * here decides which models exist or how a tier resolves; the server's
 * `GET /api/llm/config` and `GET /api/llm/catalog` did that.
 */

export const TOOLING_VENDORS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "local", label: "Local models" },
] as const;

export type ToolingVendorId = (typeof TOOLING_VENDORS)[number]["id"];
export type ToolingState = "connected" | "signed-out" | "missing" | "unknown";

/** The slice of `GET /api/llm/config` this reads. */
export interface ToolingConfig {
  effective?: { vendor: string; provider: string };
  vendorTiers?: Partial<Record<ToolingVendorId, Array<{ tier: string; model: string }>>>;
  routeOverrides?: Array<{ taskClass: string; label: string; tier: string }>;
  review?: {
    mode: { value: string };
    vendor: { value: string | null };
    rounds: { value: number };
    models: Partial<Record<string, { model: string }>>;
  };
}

/** The slice of one `GET /api/llm/catalog` vendor entry this reads. */
export interface ToolingCatalogEntry {
  cli?: { found: boolean; version: string | null };
  readiness?: { state: "ready" | "needs-setup" | "unreachable"; summary: string };
}

export type ToolingCatalog = Partial<Record<ToolingVendorId, ToolingCatalogEntry>>;

/** Result of the credential check for the active vendor; null when it was not read. */
export type ToolingAuth = { ok: boolean; detail: string | null } | null;

export interface VendorLine {
  id: ToolingVendorId;
  label: string;
  state: ToolingState;
  detail: string;
  active: boolean;
  tiers: Array<{ tier: string; model: string }>;
}

export interface ToolingSummary {
  vendors: VendorLine[];
  routes: Array<{ label: string; tier: string }>;
  review: string;
}

function vendorState(
  id: ToolingVendorId,
  entry: ToolingCatalogEntry | undefined,
  auth: ToolingAuth,
  isActiveCli: boolean,
): { state: ToolingState; detail: string } {
  if (!entry) return { state: "unknown", detail: "Status unavailable" };
  if (id === "local") {
    return entry.readiness?.state === "ready"
      ? { state: "connected", detail: entry.readiness.summary }
      : { state: "missing", detail: entry.readiness?.summary ?? "Not reachable" };
  }
  if (entry.cli && !entry.cli.found) return { state: "missing", detail: "CLI not found" };
  if (isActiveCli && auth && !auth.ok) return { state: "signed-out", detail: auth.detail ?? "Signed out" };
  if (entry.readiness?.state === "needs-setup") return { state: "signed-out", detail: entry.readiness.summary };
  if (entry.readiness?.state === "ready") return { state: "connected", detail: entry.readiness.summary };
  return { state: "unknown", detail: entry.readiness?.summary ?? "Status unavailable" };
}

function reviewLine(review: ToolingConfig["review"]): string {
  if (!review) return "Review settings unavailable";
  const mode = review.mode.value;
  if (mode === "off") return "Review off";
  if (mode === "self") return "Review: the agent checks its own work";
  const reviewer = review.vendor.value;
  const model = reviewer ? review.models[reviewer]?.model : undefined;
  const rounds = `${review.rounds.value} fix ${review.rounds.value === 1 ? "round" : "rounds"}`;
  return reviewer
    ? `Review pairing: ${reviewer}${model ? ` (${model})` : ""} · ${rounds}`
    : `Review pairing: no reviewer set · ${rounds}`;
}

export function summarizeTooling(config: ToolingConfig, catalog: ToolingCatalog | null, auth: ToolingAuth): ToolingSummary {
  const active = config.effective?.vendor;
  const activeProvider = config.effective?.provider;
  return {
    vendors: TOOLING_VENDORS.map(({ id, label }) => ({
      id,
      label,
      active: id === active,
      ...vendorState(id, catalog?.[id], auth, id === active && activeProvider === "cli"),
      tiers: config.vendorTiers?.[id] ?? [],
    })),
    routes: (config.routeOverrides ?? []).map(({ label, tier }) => ({ label, tier })),
    review: reviewLine(config.review),
  };
}
