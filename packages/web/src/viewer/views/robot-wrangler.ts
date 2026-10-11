/**
 * Robot Wrangler — configure the active vendor and per-vendor model selection.
 *
 * Surfaces llm.vendor (claude/codex/google/local), per-vendor model fields, and
 * local server connection settings from the project config, and shows what
 * `ndx work` will actually run with (the route's `effective` block, plus any
 * `effectiveProblems` it would refuse on). Renders on the shared SettingsFrame,
 * which owns Save, the dirty indicator and the leave-with-unsaved-changes prompt.
 *
 * Data: GET /api/llm/config (read) · PUT /api/llm/config (update)
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { PixelIcon, SettingsFrame } from "../components/index.js";
import { useCliName } from "../hooks/index.js";

// ── Types ─────────────────────────────────────────────────────────────

interface VendorConfig {
  model: string | null;
  lightModel: string | null;
}

interface LocalVerifierVendorConfig {
  host: string | null;
  port: number | null;
  model: string | null;
  maxCycles: number | null;
}

interface LocalVendorConfig {
  model: string | null;
  lightModel: string | null;
  host: string | null;
  port: number | null;
  maxContextTokens: number | null;
  /** Per-request timeout in ms for local completions; 0 = no timeout, null = 5 min default. */
  timeoutMs: number | null;
  verifier: LocalVerifierVendorConfig;
}

interface LlmConfigResponse {
  vendor: string | null;
  claude: VendorConfig;
  codex: VendorConfig;
  google: VendorConfig;
  local: LocalVendorConfig;
  /**
   * Where each resolved Claude field came from. `claude` above already holds
   * the resolved value; this only says whether it is still living under the
   * deprecated top-level `claude.*` key.
   */
  claudeSources: Partial<Record<"model" | "lightModel", "llm" | "legacy">>;
  autoFailover?: boolean;
  /** `hench.models.<vendor>` overrides in the project config; a vendor with none is absent. */
  agentModels: Partial<Record<string, string>>;
  /** What `ndx work` runs with no flags, resolved server-side. */
  effective: EffectiveConfig;
  /** One row per model tier of `effective.vendor`: its model, the key that set it, and who uses it. */
  tiers: TierRow[];
  /** Why `ndx work` would refuse `effective`; empty when it would run. */
  effectiveProblems: EffectiveProblem[];
}

interface EffectiveConfig {
  vendor: string;
  provider: string;
  model: string;
  modelSource: "hench-override" | "configured" | "default";
}

type TierName = "agent" | "standard" | "light" | "heavy" | "free";

/** Mirrors the server's `TierRow`; `free` is present only once it is set. */
interface TierRow {
  tier: TierName;
  /** Fully-qualified model the tier resolves to. */
  model: string;
  /** The config key that supplied `model`, or `catalog default`. */
  source: string;
  usedBy: Array<{ taskClass?: string; label: string }>;
}

interface EffectiveProblem {
  field: "provider" | "model";
  message: string;
}

type HenchProvider = "cli" | "api";

/** Installed CLI, from `<binary> --version` on the server. */
interface CliInfo {
  found: boolean;
  version: string | null;
  path: string | null;
}

/** One vendor's entry in GET /api/llm/catalog. */
interface CatalogEntry {
  models: string[];
  providers: HenchProvider[];
  defaultModel: string;
  /** Cloud vendors: where `models` came from. Local reports `reachable` instead. */
  source?: "live" | "built-in";
  checkedAt?: string | null;
  reachable?: boolean;
  reason?: string;
  cli?: CliInfo;
  /** Whether the vendor can run as configured; `summary` is shown on its card as-is. */
  readiness?: VendorReadiness;
}

/** Mirrors the server's `VendorReadiness`: the card shows `summary` and colours by `state`. */
interface VendorReadiness {
  state: "ready" | "needs-setup" | "unreachable";
  summary: string;
  /** Whether an API key resolves; omitted where no key applies. */
  apiKey?: boolean;
}

type LlmCatalog = Record<ViewerLLMVendor, CatalogEntry>;

interface LocalStatusResponse {
  ok: boolean;
  url: string;
  models: string[];
  error?: string;
}

interface SmokeTestResult {
  ok: boolean;
  latencyMs: number;
  tokensPerSecond: number | null;
  outputTokens: number | null;
  reply: string | null;
  error?: string;
  url: string;
}

interface LocalProfile {
  name: string;
  host: string;
  port: number;
  model: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const VIEWER_LLM_VENDOR = {
  CLAUDE: "claude",
  CODEX: "codex",
  GOOGLE: "google",
  LOCAL: "local",
} as const;

type ViewerLLMVendor = typeof VIEWER_LLM_VENDOR[keyof typeof VIEWER_LLM_VENDOR];

const VENDORS = [
  { id: VIEWER_LLM_VENDOR.CLAUDE, label: "Claude", subtitle: "Anthropic" },
  { id: VIEWER_LLM_VENDOR.CODEX, label: "Codex", subtitle: "OpenAI" },
  { id: VIEWER_LLM_VENDOR.GOOGLE, label: "Gemini", subtitle: "Google" },
  { id: VIEWER_LLM_VENDOR.LOCAL, label: "Local", subtitle: "LM Studio / Ollama" },
] satisfies ReadonlyArray<{ id: ViewerLLMVendor; label: string; subtitle: string }>;

/** `<option>` value for the free-entry choice; never a model id. */
const OTHER_MODEL = "__other__";

/** editValues key for the agent model override of one vendor (saved as `hench.models.<vendor>`). */
const AGENT_KEY_PREFIX = "agent.";
const agentKey = (vendor: string): string => `${AGENT_KEY_PREFIX}${vendor}`;

/**
 * editValues key of a tier row. Saving writes `llm.<key>` — except the agent
 * row, whose key is `agent.<vendor>` and saves as `hench.models.<vendor>`.
 */
function tierKey(vendor: string, tier: TierName): string {
  switch (tier) {
    case "agent": return agentKey(vendor);
    case "standard": return `${vendor}.model`;
    case "light": return `${vendor}.lightModel`;
    default: return `tiers.${vendor}.${tier}`;
  }
}

/** The config key a tier row writes, as `Set in …` names it. */
function tierConfigPath(vendor: string, tier: TierName): string {
  const key = tierKey(vendor, tier);
  return tier === "agent" ? `hench.models.${vendor}` : `llm.${key}`;
}

/** The value saved for a tier row, `""` when unset. */
function savedTierValue(data: LlmConfigResponse, vendor: string, row: TierRow): string {
  switch (row.tier) {
    case "agent": return data.agentModels?.[vendor] ?? "";
    case "standard": return data[vendor as ViewerLLMVendor]?.model ?? "";
    case "light": return data[vendor as ViewerLLMVendor]?.lightModel ?? "";
    // The response carries no raw heavy/free value: the row is set exactly when it names its own key.
    default: return row.source === tierConfigPath(vendor, row.tier) ? row.model : "";
  }
}

const TIER_LABEL: Record<TierName, string> = {
  agent: "Agent model",
  standard: "Standard",
  light: "Light",
  heavy: "Heavy",
  free: "Free",
};

/** editValues key for the hench provider (saved through PUT /api/hench/config, not the llm route). */
const PROVIDER_KEY = "provider";

/**
 * The provider to show for the active vendor, and whether saving it is needed.
 *
 * A pending edit is honoured only while the vendor still offers it — switching
 * vendor drops an edit the new vendor refuses. When the saved provider is not
 * on offer (codex saved as `api`) the first choice is shown and counts as a
 * change, since `ndx work` would refuse the saved value. Api-only vendors are
 * the exception: hench forces `api` for them whatever is saved, so there is
 * nothing to write until the user picks something. `saved` is null when hench
 * is not initialised; the field is then read-only and never dirty.
 */
function resolveProviderField(
  choices: HenchProvider[],
  saved: HenchProvider | null,
  edit: string | undefined,
): { value: HenchProvider; dirty: boolean } {
  const first = choices[0] ?? saved ?? "api";
  if (saved === null || choices.length === 0) return { value: saved ?? first, dirty: false };
  const picked = edit !== undefined && (choices as string[]).includes(edit) ? (edit as HenchProvider) : undefined;
  const value = picked ?? (choices.includes(saved) ? saved : first);
  const forcedApi = choices.length === 1 && choices[0] === "api";
  return { value, dirty: value !== saved && !(forcedApi && picked === undefined) };
}

// ── Radio cards ────────────────────────────────────────────────────────

interface RadioCardItem {
  id: string;
  /** Extra class on the card, e.g. a per-vendor hook. */
  className?: string;
  content: ComponentChildren;
}

/**
 * A `radiogroup` of cards with a roving tabindex: the selected card (else the
 * first) is the one in the tab order, and the arrow keys move selection and
 * focus together, wrapping at the ends. Without `onSelect` the group is fixed.
 */
function RadioCards({
  label,
  items,
  value,
  onSelect,
  groupClass,
}: {
  label: string;
  items: RadioCardItem[];
  value: string | null;
  onSelect?: (id: string) => void;
  groupClass: string;
}) {
  const selected = items.findIndex((i) => i.id === value);
  const tabbable = selected >= 0 ? selected : 0;
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || !onSelect) return;
    e.preventDefault();
    const next = (tabbable + step + items.length) % items.length;
    onSelect(items[next].id);
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  };
  return h("div", { class: `llm-radio-cards ${groupClass}`, role: "radiogroup", "aria-label": label, onKeyDown },
    items.map((item, i) => {
      const checked = i === selected;
      return h("button", {
        key: item.id,
        type: "button",
        role: "radio",
        "aria-checked": String(checked),
        tabIndex: i === tabbable ? 0 : -1,
        class: `llm-radio-card${checked ? " llm-radio-card-selected" : ""}${item.className ? ` ${item.className}` : ""}`,
        onClick: onSelect ? () => onSelect(item.id) : undefined,
      },
        checked ? h("span", { class: "llm-radio-card-check", "aria-hidden": "true" }, "✓") : null,
        item.content,
      );
    }),
  );
}

function SectionHeader({ number, title, subtitle }: { number: number; title: string; subtitle: string }) {
  return h("div", { class: "llm-rw-section-header" },
    h("h2", { class: "llm-rw-section-title" },
      h("span", { class: "llm-rw-section-number" }, String(number)),
      title,
    ),
    h("p", { class: "llm-rw-section-subtitle" }, subtitle),
  );
}

// ── Section 1: vendor ──────────────────────────────────────────────────

function VendorCards({
  vendor,
  catalog,
  onChange,
}: {
  vendor: string | null;
  catalog: LlmCatalog | null;
  onChange: (v: string) => void;
}) {
  return h("section", { class: "llm-rw-section" },
    h(SectionHeader, { number: 1, title: "Vendor", subtitle: "Who runs your commands" }),
    h(RadioCards, {
      label: "Vendor",
      groupClass: "llm-vendor-cards",
      value: vendor,
      onSelect: onChange,
      items: VENDORS.map((v) => {
        const readiness = catalog?.[v.id]?.readiness;
        return {
          id: v.id,
          className: `llm-vendor-card-${v.id}`,
          content: [
            h("span", { class: "llm-vendor-card-head" },
              h("span", { class: `llm-vendor-dot llm-vendor-dot-${v.id}` }),
              h("span", { class: "llm-vendor-card-name" }, v.label),
            ),
            h("span", { class: "llm-vendor-card-org" }, v.subtitle),
            readiness
              ? h("span", {
                  class: `llm-vendor-card-ready llm-vendor-card-ready-${readiness.state === "ready" ? "ok" : "warn"}`,
                }, readiness.summary)
              : null,
          ],
        };
      }),
    }),
  );
}

// ── Free-text model field ──────────────────────────────────────────────

function ModelField({
  fieldKey,
  label,
  description,
  value,
  onChange,
  dirty,
  placeholder,
}: {
  fieldKey: string;
  label: string;
  description: string;
  value: string;
  onChange: (key: string, v: string) => void;
  dirty: boolean;
  placeholder?: string;
}) {
  return h("div", { class: `llm-field${dirty ? " llm-field-dirty" : ""}` },
    h("label", { class: "llm-field-label", htmlFor: fieldKey },
      label,
      dirty ? h("span", { class: "llm-dirty-dot" }, " •") : null,
    ),
    h("p", { class: "llm-field-desc" }, description),
    h("input", {
      id: fieldKey,
      type: "text",
      class: "llm-text-input",
      value,
      placeholder: placeholder ?? "",
      onInput: (e: Event) => onChange(fieldKey, (e.target as HTMLInputElement).value),
    }),
  );
}

// ── Section 2: connection ──────────────────────────────────────────────

/** The environment variable a vendor's API connection reads its key from. */
const API_KEY_ENV: Partial<Record<ViewerLLMVendor, string>> = {
  [VIEWER_LLM_VENDOR.CLAUDE]: "ANTHROPIC_API_KEY",
  [VIEWER_LLM_VENDOR.CODEX]: "OPENAI_API_KEY",
  [VIEWER_LLM_VENDOR.GOOGLE]: "GEMINI_API_KEY",
};

/** Title and one-line description of one connection a vendor offers. */
function connectionCopy(
  vendor: ViewerLLMVendor,
  provider: HenchProvider,
  label: string,
  readiness: VendorReadiness | undefined,
): { title: string; description: string } {
  if (provider === "cli") {
    return {
      title: `${label} CLI`,
      description: vendor === VIEWER_LLM_VENDOR.CLAUDE ? "Uses your claude login. Recommended." : `Uses your ${vendor} login.`,
    };
  }
  const keyName = API_KEY_ENV[vendor];
  const none = readiness?.apiKey === false ? " · none found" : "";
  return {
    title: vendor === VIEWER_LLM_VENDOR.CLAUDE ? "Anthropic API" : vendor === VIEWER_LLM_VENDOR.LOCAL ? "Local server" : `${label} API`,
    description: keyName ? `Needs ${keyName}${none}` : "Talks to the server configured below",
  };
}

/** One radio card per provider the catalog offers; a lone provider is shown fixed, with the reason. */
function ConnectionCards({
  vendor,
  choices,
  value,
  readiness,
  onChange,
  dirty,
}: {
  vendor: ViewerLLMVendor;
  choices: HenchProvider[];
  value: HenchProvider;
  readiness: VendorReadiness | undefined;
  onChange: (key: string, v: string) => void;
  dirty: boolean;
}) {
  const cliName = useCliName();
  const label = VENDORS.find((v) => v.id === vendor)?.label ?? vendor;
  const single = choices.length === 1;
  return h("section", { class: `llm-rw-section${dirty ? " llm-field-dirty" : ""}` },
    h(SectionHeader, { number: 2, title: "Connection", subtitle: `How ${cliName} reaches ${label}` }),
    h(RadioCards, {
      label: "Connection",
      groupClass: "llm-connection-cards",
      value,
      onSelect: single ? undefined : (id) => onChange(PROVIDER_KEY, id),
      items: choices.map((p) => {
        const copy = connectionCopy(vendor, p, label, readiness);
        return {
          id: p,
          className: `llm-connection-card-${p}`,
          content: [
            h("span", { class: "llm-connection-card-title" }, copy.title),
            h("span", { class: "llm-connection-card-desc" },
              single ? `The only connection ${cliName} supports for ${label}` : copy.description),
          ],
        };
      }),
    }),
  );
}

// ── Section 3: models ──────────────────────────────────────────────────

/**
 * A dropdown over a model list. The first option is the unset choice
 * (`unsetLabel`); the last, "Other model id…", reveals a text input for an id
 * the list does not carry. A stored value the list lacks is kept as its own
 * option so it is never silently dropped from view.
 */
function ModelPicker({
  id,
  label,
  value,
  models,
  unsetLabel,
  set,
  onChange,
}: {
  id: string;
  label: string;
  /** The stored model, `""` when unset. */
  value: string;
  models: string[];
  unsetLabel: string;
  /** Whether the shown value is a setting; unset renders dashed and muted. */
  set: boolean;
  onChange: (key: string, v: string) => void;
}) {
  // Sticky: once the user picks "Other model id…" the input stays up while
  // they type, even though the half-typed id is (rightly) not in the list.
  const [custom, setCustom] = useState(false);
  const listed = value === "" || models.includes(value);
  const options = listed || custom ? models : [value, ...models];
  return h("div", { class: "llm-tier-picker" },
    h("select", {
      id,
      class: `llm-select-input ${set ? "llm-select-set" : "llm-select-unset"}`,
      "aria-label": label,
      value: custom ? OTHER_MODEL : value,
      onChange: (e: Event) => {
        const next = (e.target as HTMLSelectElement).value;
        if (next === OTHER_MODEL) {
          setCustom(true);
          return;
        }
        setCustom(false);
        onChange(id, next);
      },
    },
      h("option", { value: "" }, unsetLabel),
      options.map((m) => h("option", { key: m, value: m }, m)),
      h("option", { value: OTHER_MODEL }, "Other model id…"),
    ),
    custom
      ? h("input", {
          type: "text",
          class: "llm-text-input",
          value,
          placeholder: "model-id",
          "aria-label": `${label} — model id`,
          onInput: (e: Event) => onChange(id, (e.target as HTMLInputElement).value),
        })
      : null,
  );
}

/**
 * One row per tier the server resolved, each with who uses it, a model select
 * and where the model comes from. The rows are the server's: this renders them
 * and decides nothing about which tiers exist or what they resolve to.
 */
function TierTable({
  vendor,
  ready,
  data,
  models,
  editValues,
  dirtyKeys,
  onChange,
  catalog,
  refreshing,
  onRefresh,
}: {
  vendor: ViewerLLMVendor;
  /** False while `vendor` is picked but unsaved: the server has no tier table for it yet. */
  ready: boolean;
  data: LlmConfigResponse;
  models: string[];
  editValues: Record<string, string>;
  dirtyKeys: Set<string>;
  onChange: (key: string, v: string) => void;
  catalog: CatalogEntry | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const cliName = useCliName();
  return h("section", { class: "llm-rw-section llm-tier-section" },
    h("div", { class: "llm-rw-section-bar" },
      h(SectionHeader, {
        number: 3,
        title: "Models",
        subtitle: "Commands and tasks pick a tier; you pick the model for each",
      }),
      catalog ? h(CatalogStatus, { vendor, entry: catalog, refreshing, onRefresh }) : null,
    ),
    !ready
      ? h("p", { class: "llm-tier-pending" }, `Save the vendor change to choose models for ${vendor}.`)
      : h("div", { class: "llm-tier-table", role: "group", "aria-label": "Model tiers" },
      data.tiers.map((row) => {
        const key = tierKey(vendor, row.tier);
        const saved = savedTierValue(data, vendor, row);
        const value = editValues[key] ?? saved;
        const label = TIER_LABEL[row.tier];
        const dirty = dirtyKeys.has(key);
        // An untouched unset row can say what it resolves to; once edited the
        // server has not resolved the new choice, so it says what saving does.
        const resolved = saved === "" && !dirty;
        const where = value === ""
          ? (resolved ? `Runs as ${row.model}` : "Unset once saved")
          : `Set in ${dirty || saved === "" ? tierConfigPath(vendor, row.tier) : row.source}`;
        return h("div", {
          key: row.tier,
          class: `llm-tier-row llm-tier-row-${row.tier}${dirty ? " llm-field-dirty" : ""}`,
        },
          h("div", { class: "llm-tier-name" },
            h("label", { class: "llm-field-label", htmlFor: key },
              label,
              dirty ? h("span", { class: "llm-dirty-dot" }, " •") : null,
            ),
            row.usedBy.length > 0
              ? h("span", { class: "llm-tier-used" }, `Used by ${row.usedBy.map((u) => u.label).join(", ")}`)
              : null,
          ),
          h(ModelPicker, {
            id: key,
            label: `${label} model`,
            value,
            models,
            unsetLabel: resolved ? `Default (${row.model})` : "Default",
            set: value !== "",
            onChange,
          }),
          h("span", { class: "llm-tier-source" }, where),
        );
      }),
    ),
    h("p", { class: "llm-tier-note" },
      `Agent model overrides Standard for ${cliName} work only. A --model flag or a task's saved run settings win for that run.`),
  );
}

// ── Catalog provenance + CLI status ────────────────────────────────────

/**
 * Where the model list came from, with a Refresh that bypasses the server's
 * cache. For Claude and Codex it also reports the installed CLI — and only
 * reports it: updating or installing a CLI is not something this page does.
 */
function CatalogStatus({
  vendor,
  entry,
  refreshing,
  onRefresh,
}: {
  vendor: ViewerLLMVendor;
  entry: CatalogEntry;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const origin = vendor === VIEWER_LLM_VENDOR.LOCAL
    ? (entry.reachable ? "Live list from the local server" : `Local server unreachable${entry.reason ? ` — ${entry.reason}` : ""}`)
    : entry.source === "live"
      ? `Live list, checked ${entry.checkedAt ? new Date(entry.checkedAt).toLocaleString() : "just now"}`
      : `Built-in list${entry.reason ? ` — ${entry.reason}` : ""}`;
  const cli = entry.cli;
  return h("div", { class: "llm-catalog-status" },
    h("span", { class: "llm-catalog-origin" }, origin),
    h("button", {
      class: "llm-btn llm-btn-secondary",
      onClick: onRefresh,
      disabled: refreshing,
    }, refreshing ? "Refreshing…" : "Refresh models"),
    cli
      ? h("span", { class: "llm-catalog-cli" },
          cli.found
            ? `CLI ${cli.version ?? "installed"}`
            : "CLI not found",
        )
      : null,
  );
}

// ── Toggle switch ──────────────────────────────────────────────────────

function ToggleSwitch({
  fieldKey,
  label,
  description,
  value,
  onChange,
  dirty,
}: {
  fieldKey: string;
  label: string;
  description: string;
  value: boolean;
  onChange: (key: string, v: boolean) => void;
  dirty: boolean;
}) {
  return h("label", { class: `llm-toggle-row${dirty ? " llm-field-dirty" : ""}`, htmlFor: fieldKey },
    h("span", { class: "llm-toggle-text" },
      h("span", { class: "llm-toggle-name" },
        label,
        dirty ? h("span", { class: "llm-dirty-dot" }, " •") : null,
      ),
      h("span", { class: "llm-toggle-desc" }, description),
    ),
    h("span", { class: "llm-toggle-wrap" },
      h("input", {
        id: fieldKey,
        type: "checkbox",
        class: "llm-toggle-input",
        checked: value,
        onChange: (e: Event) => onChange(fieldKey, (e.target as HTMLInputElement).checked),
      }),
      h("span", { class: "llm-toggle-track" }),
    ),
  );
}

// ── Effective block ───────────────────────────────────────────────────

const MODEL_SOURCE_LABEL: Record<EffectiveConfig["modelSource"], string> = {
  "hench-override": "agent model override",
  configured: "configured",
  default: "vendor default",
};

/**
 * What `ndx work` will run with no flags. The route resolves it and, when it
 * would refuse the result, lists why in `problems` — this component only
 * renders; it applies no rules of its own.
 */
function EffectiveBlock({ effective, problems }: { effective: EffectiveConfig; problems: EffectiveProblem[] }) {
  const cliName = useCliName();
  const refused = problems.length > 0;
  return h("section", {
    class: `llm-effective${refused ? " llm-effective-refused" : ""}`,
    "aria-label": `What ${cliName} work will run`,
  },
    h("p", { class: "llm-section-sub" }, `${cliName} work will run with`),
    h("dl", { class: "llm-effective-list" },
      h("dt", null, "Vendor"), h("dd", null, effective.vendor),
      h("dt", null, "Provider"), h("dd", null, effective.provider),
      h("dt", null, "Model"),
      h("dd", null, effective.model,
        h("span", { class: "llm-effective-source" }, ` (${MODEL_SOURCE_LABEL[effective.modelSource]})`)),
    ),
    refused
      ? h("div", { class: "llm-effective-problems", role: "alert" },
          h("strong", null, `${cliName} work would refuse this configuration`),
          h("ul", null, problems.map((p) => h("li", { key: p.field }, p.message))),
        )
      : null,
  );
}

// ── Smoke test ─────────────────────────────────────────────────────────

function SmokeTestButton({
  host, port, model, hasDirtyFields,
}: {
  host: string; port: string; model: string; hasDirtyFields: boolean;
}) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<SmokeTestResult | null>(null);

  const run = useCallback(async () => {
    setState("running");
    setResult(null);
    try {
      const portNum = parseInt(port, 10);
      const res = await fetch("/api/llm/local-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: host || "localhost", port: portNum > 0 ? portNum : 1234, model }),
      });
      setResult(await res.json() as SmokeTestResult);
    } catch (err) {
      setResult({ ok: false, latencyMs: 0, tokensPerSecond: null, outputTokens: null, reply: null,
        error: err instanceof Error ? err.message : "Request failed", url: "" });
    } finally {
      setState("done");
    }
  }, [host, port, model]);

  return h("div", { class: "llm-smoke-row" },
    h("button", {
      class: `llm-btn llm-btn-secondary${state === "running" ? " llm-btn-loading" : ""}`,
      onClick: run,
      disabled: state === "running",
    }, state === "running" ? "Testing…" : "Test connection"),
    hasDirtyFields && state !== "running"
      ? h("span", { class: "llm-smoke-hint" }, "using current edits")
      : null,
    result
      ? result.ok
        ? h("span", { class: "llm-smoke-ok" },
            `✓ ${result.latencyMs}ms`,
            result.tokensPerSecond !== null
              ? h("span", { class: "llm-smoke-meta" }, ` · ${result.tokensPerSecond} tok/s`)
              : null,
            result.reply
              ? h("span", { class: "llm-smoke-reply" }, ` · "${result.reply}"`)
              : null,
          )
        : h("span", { class: "llm-smoke-err" }, `✕ ${result.error ?? "Failed"}`)
      : null,
  );
}

// ── Local server status ────────────────────────────────────────────────

function useLocalStatus(enabled: boolean): { status: LocalStatusResponse | null; refresh: () => void } {
  const [status, setStatus] = useState<LocalStatusResponse | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/llm/local-status");
      if (res.ok) setStatus(await res.json() as LocalStatusResponse);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!enabled) { setStatus(null); return; }
    void probe();
    timer.current = setInterval(() => { void probe(); }, 10_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [enabled, probe]);

  return { status, refresh: probe };
}

function StatusPill({ status, onRefresh }: { status: LocalStatusResponse | null; onRefresh: () => void }) {
  const refresh = h("button", {
    class: "llm-pill-refresh",
    onClick: onRefresh,
    title: "Re-check",
    "aria-label": "Refresh connection status",
  }, "↺");

  if (!status) {
    return h("span", { class: "llm-status-pill llm-status-checking" },
      h("span", { class: "llm-pill-dot" }),
      "Checking…",
      refresh,
    );
  }
  if (status.ok) {
    const n = status.models.length;
    return h("span", { class: "llm-status-pill llm-status-ok" },
      h("span", { class: "llm-pill-dot" }),
      n > 0 ? `${n} model${n === 1 ? "" : "s"} available` : "Connected",
      h("code", { class: "llm-pill-url" }, status.url),
      refresh,
    );
  }
  return h("span", { class: "llm-status-pill llm-status-err" },
    h("span", { class: "llm-pill-dot" }),
    status.error ?? "Server unreachable",
    h("code", { class: "llm-pill-url" }, status.url),
    refresh,
  );
}

// ── Saved profiles panel ────────────────────────────────────────────────

function ProfilesPanel({
  currentValues,
  onChange,
}: {
  currentValues: { host: string; port: string; model: string };
  onChange: (key: string, v: string) => void;
}) {
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [showInput, setShowInput] = useState(false);

  useEffect(() => {
    fetch("/api/llm/local-profiles")
      .then((r) => r.json() as Promise<{ profiles: LocalProfile[] }>)
      .then((d) => setProfiles(d.profiles ?? []))
      .catch(() => {});
  }, []);

  const apply = useCallback((p: LocalProfile) => {
    onChange("local.host", p.host);
    onChange("local.port", String(p.port));
    onChange("local.model", p.model ?? "");
  }, [onChange]);

  const save = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await fetch("/api/llm/local-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          host: currentValues.host || "localhost",
          port: parseInt(currentValues.port, 10) || 1234,
          model: currentValues.model,
        }),
      });
      const d = await res.json() as { profiles: LocalProfile[] };
      setProfiles(d.profiles ?? []);
      setNewName("");
      setShowInput(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [newName, currentValues]);

  const del = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/llm/local-profiles?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const d = await res.json() as { profiles: LocalProfile[] };
      setProfiles(d.profiles ?? []);
    } catch { /* ignore */ }
  }, []);

  return h("div", { class: "llm-profiles" },
    h("div", { class: "llm-profiles-bar" },
      showInput
        ? h("div", { class: "llm-profiles-save-row" },
            h("input", {
              class: "llm-text-input",
              type: "text",
              placeholder: "Profile name",
              value: newName,
              autoFocus: true,
              onInput: (e: Event) => setNewName((e.target as HTMLInputElement).value),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") { setShowInput(false); setNewName(""); }
              },
            }),
            h("button", {
              class: "llm-btn llm-btn-primary",
              onClick: () => void save(),
              disabled: saving || !newName.trim(),
            }, saving ? "Saving…" : "Save"),
            h("button", {
              class: "llm-btn llm-btn-secondary",
              onClick: () => { setShowInput(false); setNewName(""); },
            }, "Cancel"),
          )
        : h("button", {
            class: "llm-btn llm-btn-secondary llm-profiles-new-btn",
            onClick: () => setShowInput(true),
          }, "+ Save current as profile"),
    ),
    profiles.length > 0
      ? h("div", { class: "llm-profiles-list" },
          profiles.map((p) =>
            h("div", { key: p.name, class: "llm-profile-row" },
              h("div", { class: "llm-profile-info" },
                h("span", { class: "llm-profile-name" }, p.name),
                h("span", { class: "llm-profile-meta" },
                  `${p.host}:${p.port}${p.model ? ` · ${p.model.length > 32 ? `…${p.model.slice(-29)}` : p.model}` : ""}`,
                ),
              ),
              h("div", { class: "llm-profile-btns" },
                h("button", {
                  class: "llm-btn llm-btn-secondary llm-profile-apply",
                  onClick: () => apply(p),
                }, "Apply"),
                h("button", {
                  class: "llm-profile-del",
                  onClick: () => void del(p.name),
                  title: `Delete "${p.name}"`,
                  "aria-label": `Delete profile "${p.name}"`,
                }, "✕"),
              ),
            ),
          ),
        )
      : h("p", { class: "llm-profiles-empty" }, "No profiles saved yet."),
  );
}

// ── Local server section (flat layout) ────────────────────────────────

function LocalSection({
  config, editValues, onChange, dirtyKeys, localStatus, onRefreshStatus,
}: {
  config: LocalVendorConfig;
  editValues: Record<string, string>;
  onChange: (key: string, v: string) => void;
  dirtyKeys: Set<string>;
  localStatus: LocalStatusResponse | null;
  onRefreshStatus: () => void;
}) {
  const host  = editValues["local.host"]       ?? config.host              ?? "localhost";
  const port  = editValues["local.port"]       ?? (config.port !== null ? String(config.port) : "1234");
  const model = editValues["local.model"]      ?? config.model             ?? "";

  const maxContextTokens = editValues["local.maxContextTokens"]
    ?? (config.maxContextTokens !== null ? String(config.maxContextTokens) : "");
  const timeoutMs = editValues["local.timeoutMs"]
    ?? (config.timeoutMs !== null ? String(config.timeoutMs) : "");
  const verifierHost = editValues["local.verifier.host"] ?? config.verifier.host ?? "";
  const verifierPort = editValues["local.verifier.port"]
    ?? (config.verifier.port !== null ? String(config.verifier.port) : "");
  const verifierModel = editValues["local.verifier.model"] ?? config.verifier.model ?? "";
  const verifierMaxCycles = editValues["local.verifier.maxCycles"]
    ?? (config.verifier.maxCycles !== null ? String(config.verifier.maxCycles) : "");
  const verifierDirty = dirtyKeys.has("local.verifier.host") || dirtyKeys.has("local.verifier.port")
    || dirtyKeys.has("local.verifier.model") || dirtyKeys.has("local.verifier.maxCycles");
  const verifierConfigured = config.verifier.host !== null || config.verifier.port !== null;

  const connDirty = dirtyKeys.has("local.host") || dirtyKeys.has("local.port");

  return h("div", { class: "llm-vendor-section" },

    // ── Status pill (always first)
    h("div", { class: "llm-local-top" },
      h(StatusPill, { status: localStatus, onRefresh: onRefreshStatus }),
    ),

    h("hr", { class: "llm-rule" }),

    // ── Connection settings
    h("p", { class: "llm-section-sub" }, "Connection"),
    h("div", { class: "llm-conn-row" },
      h("div", { class: `llm-field${dirtyKeys.has("local.host") ? " llm-field-dirty" : ""}` },
        h("label", { class: "llm-field-label", htmlFor: "local.host" },
          "Host",
          dirtyKeys.has("local.host") ? h("span", { class: "llm-dirty-dot" }, " •") : null,
        ),
        h("input", {
          id: "local.host",
          type: "text",
          class: "llm-text-input",
          value: host,
          placeholder: "localhost",
          list: "llm-dl-local-host",
          onInput: (e: Event) => onChange("local.host", (e.target as HTMLInputElement).value),
        }),
        h("datalist", { id: "llm-dl-local-host" },
          h("option", { value: "localhost" }),
          h("option", { value: "127.0.0.1" }),
        ),
      ),
      h("div", { class: `llm-field${dirtyKeys.has("local.port") ? " llm-field-dirty" : ""}` },
        h("label", { class: "llm-field-label", htmlFor: "local.port" },
          "Port",
          dirtyKeys.has("local.port") ? h("span", { class: "llm-dirty-dot" }, " •") : null,
        ),
        h("input", {
          id: "local.port",
          type: "text",
          class: "llm-text-input",
          value: port,
          placeholder: "1234",
          list: "llm-dl-local-port",
          onInput: (e: Event) => onChange("local.port", (e.target as HTMLInputElement).value),
        }),
        h("datalist", { id: "llm-dl-local-port" },
          h("option", { value: "1234" }),
          h("option", { value: "11434" }),
          h("option", { value: "8080" }),
        ),
      ),
    ),
    h(SmokeTestButton, {
      host, port, model,
      hasDirtyFields: connDirty || dirtyKeys.has("local.model"),
    }),

    h("hr", { class: "llm-rule" }),

    // ── Advanced: context budget + second-model verifier
    h("p", { class: "llm-section-sub" }, "Advanced"),
    h("div", { class: `llm-field${dirtyKeys.has("local.maxContextTokens") ? " llm-field-dirty" : ""}` },
      h("label", { class: "llm-field-label", htmlFor: "local.maxContextTokens" },
        "Max context tokens",
        dirtyKeys.has("local.maxContextTokens") ? h("span", { class: "llm-dirty-dot" }, " •") : null,
      ),
      h("p", { class: "llm-field-desc" },
        "Check that a brief fits before sending it, so an oversized prompt fails fast with a clear error instead of a cryptic HTTP 400. Match your server's \"Context Length\" setting. Leave blank to skip this check.",
      ),
      h("input", {
        id: "local.maxContextTokens",
        type: "text",
        inputMode: "numeric",
        class: "llm-text-input",
        value: maxContextTokens,
        placeholder: "e.g. 32768",
        onInput: (e: Event) => onChange("local.maxContextTokens", (e.target as HTMLInputElement).value),
      }),
    ),
    h("div", { class: `llm-field${dirtyKeys.has("local.timeoutMs") ? " llm-field-dirty" : ""}` },
      h("label", { class: "llm-field-label", htmlFor: "local.timeoutMs" },
        "Request timeout (ms)",
        dirtyKeys.has("local.timeoutMs") ? h("span", { class: "llm-dirty-dot" }, " •") : null,
      ),
      h("p", { class: "llm-field-desc" },
        "How long to wait for a single response from the local server. Enter 0 for no limit, or e.g. 7200000 for 2 hours. Leave blank for the 5-minute default. This is per request — the CLI timeouts on the Workflow page bound the whole command instead, so setting those to unlimited does not extend this.",
      ),
      h("input", {
        id: "local.timeoutMs",
        type: "text",
        inputMode: "numeric",
        class: "llm-text-input",
        value: timeoutMs,
        placeholder: "e.g. 7200000 (0 = no limit)",
        onInput: (e: Event) => onChange("local.timeoutMs", (e.target as HTMLInputElement).value),
      }),
    ),
    h("details", { class: "llm-verifier-details", open: verifierConfigured || verifierDirty },
      h("summary", { class: "llm-verifier-summary" },
        "Second-model verifier (optional)",
        verifierDirty ? h("span", { class: "llm-dirty-dot" }, " •") : null,
      ),
      h("p", { class: "llm-field-desc" },
        "After the primary model finishes, send its solution to a second local endpoint for review before finalizing the run. Good pairing: a smaller/faster model here. Leave all fields blank to disable.",
      ),
      h("div", { class: "llm-conn-row" },
        h("div", { class: `llm-field${dirtyKeys.has("local.verifier.host") ? " llm-field-dirty" : ""}` },
          h("label", { class: "llm-field-label", htmlFor: "local.verifier.host" }, "Host"),
          h("input", {
            id: "local.verifier.host",
            type: "text",
            class: "llm-text-input",
            value: verifierHost,
            placeholder: "localhost",
            onInput: (e: Event) => onChange("local.verifier.host", (e.target as HTMLInputElement).value),
          }),
        ),
        h("div", { class: `llm-field${dirtyKeys.has("local.verifier.port") ? " llm-field-dirty" : ""}` },
          h("label", { class: "llm-field-label", htmlFor: "local.verifier.port" }, "Port"),
          h("input", {
            id: "local.verifier.port",
            type: "text",
            inputMode: "numeric",
            class: "llm-text-input",
            value: verifierPort,
            placeholder: "1235",
            onInput: (e: Event) => onChange("local.verifier.port", (e.target as HTMLInputElement).value),
          }),
        ),
      ),
      h(ModelField, {
        fieldKey: "local.verifier.model",
        label: "Model",
        description: "Leave blank to use whichever model is currently loaded on the verifier endpoint.",
        value: verifierModel,
        onChange,
        dirty: dirtyKeys.has("local.verifier.model"),
        placeholder: "model-id",
      }),
      h("div", { class: `llm-field${dirtyKeys.has("local.verifier.maxCycles") ? " llm-field-dirty" : ""}` },
        h("label", { class: "llm-field-label", htmlFor: "local.verifier.maxCycles" }, "Max review cycles"),
        h("p", { class: "llm-field-desc" }, "How many FAIL → revise rounds before finalizing regardless (default: 2)."),
        h("input", {
          id: "local.verifier.maxCycles",
          type: "text",
          inputMode: "numeric",
          class: "llm-text-input",
          value: verifierMaxCycles,
          placeholder: "2",
          onInput: (e: Event) => onChange("local.verifier.maxCycles", (e.target as HTMLInputElement).value),
        }),
      ),
    ),

    h("hr", { class: "llm-rule" }),

    // ── Profiles
    h("p", { class: "llm-section-sub" }, "Saved profiles"),
    h(ProfilesPanel, {
      currentValues: { host, port, model },
      onChange,
    }),
  );
}

// ── Credential status ─────────────────────────────────────────────────

/**
 * Credential status for the configured provider.
 *
 * Runs the same check as `<cli> auth`, so a missing or invalid key is visible
 * here rather than only when an agent command fails later.
 */
export function AuthStatusChip() {
  const cliName = useCliName();
  const [state, setState] = useState<"checking" | "ok" | "bad">("checking");
  const [detail, setDetail] = useState<string | null>(null);

  const check = useCallback(async (force = false) => {
    setState("checking");
    setDetail(null);
    try {
      // Force bypasses the server's cached result; the plain form is served
      // from cache, so navigating to this page doesn't spawn a subprocess.
      const res = await fetch(force ? "/api/commands/auth?refresh=true" : "/api/commands/auth");
      const body = await res.json() as { ok?: boolean; error?: string | null; output?: string };
      if (body.ok) {
        setState("ok");
        setDetail(body.output?.split("\n").filter(Boolean).pop() ?? null);
      } else {
        setState("bad");
        setDetail(body.error ?? "Credential check failed");
      }
    } catch (err) {
      setState("bad");
      setDetail(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return h("div", { class: `auth-chip auth-chip-${state}`, role: "status", "aria-live": "polite" },
    h("span", { class: "auth-chip-dot", "aria-hidden": "true" }),
    h("span", { class: "auth-chip-label" },
      state === "checking" ? "Checking credentials…"
        : state === "ok" ? "Credentials OK"
        : "Credentials not usable",
    ),
    detail ? h("span", { class: "auth-chip-detail" }, detail) : null,
    h("button", {
      class: "cmd-btn cmd-btn-small",
      // Not `onClick: check` — that would pass the MouseEvent as `force`.
      onClick: () => check(true),
      disabled: state === "checking",
      title: `Re-run ${cliName} auth`,
    }, "Re-check"),
  );
}

// ── Main view ─────────────────────────────────────────────────────────

export function RobotWranglerView() {
  const cliName = useCliName();
  const [data, setData] = useState<LlmConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editValues,  setEditValues]  = useState<Record<string, string>>({});
  const [editToggles, setEditToggles] = useState<Record<string, boolean>>({});
  const [pendingVendor, setPendingVendor] = useState<string | null | undefined>(undefined);

  const effectiveVendor = pendingVendor !== undefined ? pendingVendor : data?.vendor ?? null;
  const showLocal = effectiveVendor === VIEWER_LLM_VENDOR.LOCAL;
  // The server resolves the tier table for the saved vendor, so a vendor card
  // picked but not yet saved has no table of its own to show.
  const tiersShown = data !== null && effectiveVendor !== null && data.effective.vendor === effectiveVendor;
  const { status: localStatus, refresh: refreshLocal } = useLocalStatus(showLocal);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/llm/config");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load");
        return;
      }
      setData(await res.json() as LlmConfigResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // The catalog holds every vendor, so switching vendor reads another entry
  // rather than refetching — nothing from the previous vendor can linger.
  const [catalog, setCatalog] = useState<LlmCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadCatalog = useCallback(async (refresh: boolean) => {
    setRefreshing(refresh);
    try {
      const res = await fetch(refresh ? "/api/llm/catalog?refresh=true" : "/api/llm/catalog");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCatalogError((body as { error?: string }).error ?? `Model catalog unavailable (HTTP ${res.status})`);
        return;
      }
      setCatalog(await res.json() as LlmCatalog);
      setCatalogError(null);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Model catalog unavailable");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadCatalog(false); }, [loadCatalog]);

  // The saved hench provider. Null when hench is not initialised, in which case
  // the page reports the effective provider and offers no edit.
  const [henchProvider, setHenchProvider] = useState<HenchProvider | null>(null);
  useEffect(() => {
    fetch("/api/hench/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { config?: { provider?: string } } | null) => {
        const p = body?.config?.provider;
        if (p === "cli" || p === "api") setHenchProvider(p);
      })
      .catch(() => { /* hench not initialised; provider stays read-only */ });
  }, []);

  const handleVendorChange = useCallback((v: string | null) => setPendingVendor(v), []);
  const handleField  = useCallback((key: string, val: string)  => setEditValues((p)  => ({ ...p, [key]: val })), []);
  const handleToggle = useCallback((key: string, val: boolean) => setEditToggles((p) => ({ ...p, [key]: val })), []);

  // ── Dirty tracking
  //
  // Scoped to `effectiveVendor` (the currently-visible tab) only. editValues
  // itself is never cleared on tab switch — so a draft edit on a hidden tab
  // is preserved if the user comes back to it — but it must never leak into
  // a Save triggered from a *different* tab. Computing dirtyKeys (and thus
  // handleSave's payload and the "N unsaved changes" count below) only from
  // the active tab's own fields is what keeps that hidden draft from being
  // silently included in an unrelated save.
  const dirtyKeys = new Set<string>();
  if (data) {
    // The tier rows describe the saved vendor; only they are editable, and only
    // while that is the vendor on screen.
    if (tiersShown && effectiveVendor) {
      for (const row of data.tiers) {
        const k = tierKey(effectiveVendor, row.tier);
        if (k in editValues && editValues[k] !== savedTierValue(data, effectiveVendor, row)) dirtyKeys.add(k);
      }
    }
    if (effectiveVendor === VIEWER_LLM_VENDOR.LOCAL) {
      if ("local.host" in editValues && editValues["local.host"] !== (data.local.host ?? "")) dirtyKeys.add("local.host");
      if ("local.port" in editValues) {
        const saved = data.local.port !== null ? String(data.local.port) : "1234";
        if (editValues["local.port"] !== saved) dirtyKeys.add("local.port");
      }
      if ("local.maxContextTokens" in editValues) {
        const saved = data.local.maxContextTokens !== null ? String(data.local.maxContextTokens) : "";
        if (editValues["local.maxContextTokens"] !== saved) dirtyKeys.add("local.maxContextTokens");
      }
      if ("local.timeoutMs" in editValues) {
        const saved = data.local.timeoutMs !== null ? String(data.local.timeoutMs) : "";
        if (editValues["local.timeoutMs"] !== saved) dirtyKeys.add("local.timeoutMs");
      }
      for (const f of ["host", "model"] as const) {
        const k = `local.verifier.${f}`;
        if (k in editValues && editValues[k] !== (data.local.verifier[f] ?? "")) dirtyKeys.add(k);
      }
      for (const f of ["port", "maxCycles"] as const) {
        const k = `local.verifier.${f}`;
        if (k in editValues) {
          const saved = data.local.verifier[f] !== null ? String(data.local.verifier[f]) : "";
          if (editValues[k] !== saved) dirtyKeys.add(k);
        }
      }
    }
  }
  const vendorDirty = pendingVendor !== undefined && pendingVendor !== (data?.vendor ?? null);

  const dirtyToggles = new Set<string>();
  if (data && "autoFailover" in editToggles && editToggles.autoFailover !== (data.autoFailover ?? false)) {
    dirtyToggles.add("autoFailover");
  }

  // The provider belongs to the active vendor's catalog entry, so it follows
  // the vendor selection (saved or pending) and never offers a stale choice.
  const vendorCatalog: CatalogEntry | null = effectiveVendor
    ? catalog?.[effectiveVendor as ViewerLLMVendor] ?? null
    : null;
  const providerChoices = vendorCatalog?.providers ?? [];
  const provider = resolveProviderField(providerChoices, henchProvider, editValues[PROVIDER_KEY]);

  const hasChanges = dirtyKeys.size > 0 || vendorDirty || dirtyToggles.size > 0 || provider.dirty;

  // Two writes, in this order: the hench route validates `provider` against the
  // *saved* vendor, so the llm write (which may change the vendor) goes first.
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const changes: Record<string, string | null | boolean> = {};
      if (vendorDirty) changes["llm.vendor"] = pendingVendor;
      for (const key of dirtyKeys) {
        const raw = editValues[key] ?? "";
        const value = raw.trim() || null;
        // "agent.claude" → hench.models.claude; "claude.model" → llm.claude.model
        if (key.startsWith(AGENT_KEY_PREFIX)) changes[`hench.models.${key.slice(AGENT_KEY_PREFIX.length)}`] = value;
        else changes[`llm.${key}`] = value;
      }
      for (const key of dirtyToggles) {
        if (key === "autoFailover") changes["llm.autoFailover"] = editToggles.autoFailover;
      }

      if (Object.keys(changes).length > 0) {
        const res = await fetch("/api/llm/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Save failed" }));
          // Edits stay in place and `dirty` stays true, so the frame keeps Save
          // enabled and the leave prompt armed.
          setError((body as { error?: string }).error ?? "Failed to save");
          return;
        }
        const json = await res.json() as { config: LlmConfigResponse };
        setData(json.config);
        // The llm part is saved: clear it, but keep a pending provider edit so
        // a failed second write leaves exactly that field dirty.
        setEditValues((prev) => {
          const pending: Record<string, string> = {};
          if (PROVIDER_KEY in prev) pending[PROVIDER_KEY] = prev[PROVIDER_KEY];
          return pending;
        });
        setEditToggles({});
        setPendingVendor(undefined);
      }

      if (provider.dirty) {
        const res = await fetch("/api/hench/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes: { provider: provider.value } }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Save failed" }));
          setError((body as { error?: string }).error ?? "Failed to save the provider");
          return;
        }
        setHenchProvider(provider.value);
        setEditValues((prev) => {
          const { [PROVIDER_KEY]: _saved, ...rest } = prev;
          return rest;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [vendorDirty, pendingVendor, dirtyKeys, dirtyToggles, editValues, editToggles, provider.dirty, provider.value]);

  const handleDiscard = useCallback(() => {
    setEditValues({});
    setEditToggles({});
    setPendingVendor(undefined);
    setError(null);
  }, []);

  if (loading) {
    return h("div", { class: "llm-container" },
      h("div", { class: "loading" }, "Loading…"),
    );
  }

  if (error && !data) {
    return h("div", { class: "llm-container" },
      h("div", { class: "llm-error-state" }, error),
    );
  }

  // A field is "legacy" when its resolved value came from the deprecated
  // top-level `claude.*` key. The value itself is already shown in the field
  // above — this notice only explains where it is still stored.
  const legacyFields = (["model", "lightModel"] as const)
    .filter((f) => data?.claudeSources?.[f] === "legacy");
  const showLegacy = legacyFields.length > 0;

  return h(SettingsFrame, {
    dirty: hasChanges,
    saving,
    error,
    onSave: handleSave,
    onDiscard: handleDiscard,
  },
   h("div", { class: "llm-container" },

    h("div", { class: "llm-header" },
      h("div", { class: "llm-header-brand" },
        h(PixelIcon, { name: "robot-wrangler", variant: "tile", size: 40, class: "llm-header-tile" }),
        h("span", { class: "llm-header-title" }, "Robot Wrangler"),
      ),
      h("p", { class: "llm-header-subtitle" },
        "Provider and model for all LLM commands (",
        h("code", null, `${cliName} work`),
        ", ",
        h("code", null, `${cliName} plan`),
        ", ",
        h("code", null, `${cliName} recommend`),
        "). Select the active vendor and configure model IDs. ",
        "Changes are saved to the project config and take effect on the next run.",
      ),
    ),

    // ── Credential status for the configured provider
    h(AuthStatusChip, null),

    // What `ndx work` will run, per the route (saved config, not pending edits)
    data ? h(EffectiveBlock, { effective: data.effective, problems: data.effectiveProblems }) : null,

    h(VendorCards, {
      vendor: effectiveVendor,
      catalog,
      onChange: handleVendorChange,
    }),

    (effectiveVendor && data)
      ? h(ConnectionCards, {
          vendor: effectiveVendor as ViewerLLMVendor,
          choices: providerChoices.length > 0 ? providerChoices : [provider.value],
          value: provider.value,
          readiness: vendorCatalog?.readiness,
          onChange: handleField,
          dirty: provider.dirty,
        })
      : null,

    catalogError
      ? h("p", { class: "llm-catalog-error", role: "alert" },
          `${catalogError}. Model lists are empty; use "Other model id…" to enter an id.`)
      : null,
    // The server's tier table, for the vendor it resolved it for. The local
    // vendor lists what its server reports as loaded rather than a catalog.
    (effectiveVendor && data)
      ? h(TierTable, {
          key: `tiers-${effectiveVendor}`,
          vendor: effectiveVendor as ViewerLLMVendor,
          ready: tiersShown,
          data,
          models: showLocal && localStatus?.ok && localStatus.models.length > 0
            ? localStatus.models
            : vendorCatalog?.models ?? [],
          editValues,
          dirtyKeys,
          onChange: handleField,
          catalog: vendorCatalog,
          refreshing,
          onRefresh: () => { void loadCatalog(true); },
        })
      : null,

    showLocal
      ? h(LocalSection, {
          key: VIEWER_LLM_VENDOR.LOCAL,
          config: data!.local ?? {
            model: null, lightModel: null, host: null, port: null,
            maxContextTokens: null, timeoutMs: null,
            verifier: { host: null, port: null, model: null, maxCycles: null },
          },
          editValues,
          onChange: handleField,
          dirtyKeys,
          localStatus,
          onRefreshStatus: refreshLocal,
        })
      : null,
    !effectiveVendor
      ? h("p", { class: "llm-no-vendor" }, "Select a vendor above to configure its settings.")
      : null,

    // Failover toggle
    h("div", { class: "llm-failover-wrap" },
      h(ToggleSwitch, {
        fieldKey: "autoFailover",
        label: "Automatic failover",
        description: "Retry on fallback models before surfacing an error.",
        value: editToggles.autoFailover ?? data?.autoFailover ?? false,
        onChange: handleToggle,
        dirty: dirtyToggles.has("autoFailover"),
      }),
    ),

    // Legacy notice
    showLegacy
      ? h("div", { class: "llm-legacy" },
          h("span", null, "ℹ"),
          h("div", null,
            h("strong", null, "Still set under a deprecated key"),
            h("p", null,
              legacyFields.map((f) => `claude.${f}`).join(" and "),
              legacyFields.length === 1 ? " is " : " are ",
              "read from the legacy top-level key. The value shown above is the one that will run. ",
              "Saving writes the modern ",
              h("code", null, "llm.claude.*"),
              " field and leaves the old key where it is.",
            ),
          ),
        )
      : null,
   ),
  );
}
