/**
 * LLM Provider view — configure active vendor and per-vendor model selection.
 *
 * Surfaces llm.vendor (claude/codex/local), per-vendor model fields, and
 * local server connection settings from `.n-dx.json`.
 *
 * Data: GET /api/llm/config (read) · PUT /api/llm/config (update)
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { NdxLogoPng } from "../components/index.js";
import { useCliName } from "../hooks/index.js";

// ── Types ─────────────────────────────────────────────────────────────

interface VendorConfig {
  model: string | null;
  lightModel: string | null;
}

interface LocalVendorConfig {
  model: string | null;
  lightModel: string | null;
  host: string | null;
  port: number | null;
}

interface LlmConfigResponse {
  vendor: string | null;
  claude: VendorConfig;
  codex: VendorConfig;
  local: LocalVendorConfig;
  legacyClaude: VendorConfig;
  autoFailover?: boolean;
}

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
  LOCAL: "local",
} as const;

type ViewerLLMVendor = typeof VIEWER_LLM_VENDOR[keyof typeof VIEWER_LLM_VENDOR];
type CloudViewerVendor = typeof VIEWER_LLM_VENDOR.CLAUDE | typeof VIEWER_LLM_VENDOR.CODEX;

const VENDORS = [
  { id: VIEWER_LLM_VENDOR.CLAUDE, label: "Claude", subtitle: "Anthropic" },
  { id: VIEWER_LLM_VENDOR.CODEX, label: "Codex", subtitle: "OpenAI" },
  { id: VIEWER_LLM_VENDOR.LOCAL, label: "Local", subtitle: "LM Studio / Ollama" },
] satisfies ReadonlyArray<{ id: ViewerLLMVendor; label: string; subtitle: string }>;

const MODEL_SUGGESTIONS: Record<ViewerLLMVendor, string[]> = {
  [VIEWER_LLM_VENDOR.CLAUDE]: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-3-5", "claude-3-7-sonnet-20250219"],
  [VIEWER_LLM_VENDOR.CODEX]: ["codex-mini", "o4-mini", "o3"],
  [VIEWER_LLM_VENDOR.LOCAL]: [],
};

// ── Vendor selector (segmented control) ───────────────────────────────

function VendorSelector({
  vendor,
  onChange,
  localStatus,
}: {
  vendor: string | null;
  onChange: (v: string | null) => void;
  localStatus: LocalStatusResponse | null;
}) {
  const cliName = useCliName();
  return h("div", { class: "llm-vendor-selector" },
    h("div", { class: "llm-vendor-tabs" },
      VENDORS.map((v) => {
        const active = vendor === v.id;
        // Connection dot on local tab
        const connDot =
          v.id === VIEWER_LLM_VENDOR.LOCAL && localStatus !== null
            ? h("span", {
                class: `llm-tab-conn-dot ${localStatus.ok ? "llm-tab-conn-ok" : "llm-tab-conn-err"}`,
                title: localStatus.ok ? "Server reachable" : "Server unreachable",
              })
            : null;
        return h("button", {
          key: v.id,
          class: `llm-vendor-tab${active ? " llm-vendor-tab-active" : ""} llm-vendor-tab-${v.id}`,
          onClick: () => onChange(v.id),
          "aria-pressed": String(active),
        },
          h("span", { class: `llm-vendor-dot llm-vendor-dot-${v.id}` }),
          h("span", { class: "llm-tab-name" }, v.label),
          connDot,
        );
      }),
    ),
    h("p", { class: "llm-vendor-hint" },
      vendor
        ? `Using ${VENDORS.find((v) => v.id === vendor)?.subtitle ?? vendor} for all ${cliName} commands.`
        : `No vendor selected — ${cliName} commands will fall back to defaults.`,
    ),
  );
}

// ── Free-text model field (with optional datalist suggestions) ─────────

function ModelField({
  fieldKey,
  label,
  description,
  value,
  suggestions,
  onChange,
  dirty,
  placeholder,
}: {
  fieldKey: string;
  label: string;
  description: string;
  value: string;
  suggestions: string[];
  onChange: (key: string, v: string) => void;
  dirty: boolean;
  placeholder?: string;
}) {
  const listId = suggestions.length > 0 ? `llm-dl-${fieldKey}` : undefined;
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
      list: listId,
      placeholder: placeholder ?? (suggestions[0] ? `e.g. ${suggestions[0]}` : ""),
      onInput: (e: Event) => onChange(fieldKey, (e.target as HTMLInputElement).value),
    }),
    listId
      ? h("datalist", { id: listId },
          suggestions.map((s) => h("option", { key: s, value: s })),
        )
      : null,
  );
}

// ── Select-based model picker (local vendor with live model list) ───────

function ModelSelect({
  fieldKey,
  label,
  description,
  value,
  models,
  onChange,
  dirty,
}: {
  fieldKey: string;
  label: string;
  description: string;
  value: string;
  models: string[];
  onChange: (key: string, v: string) => void;
  dirty: boolean;
}) {
  // Include current value as an option even if it's no longer in the live list
  const extra = value && !models.includes(value) ? [value] : [];
  return h("div", { class: `llm-field${dirty ? " llm-field-dirty" : ""}` },
    h("label", { class: "llm-field-label", htmlFor: fieldKey },
      label,
      dirty ? h("span", { class: "llm-dirty-dot" }, " •") : null,
    ),
    h("p", { class: "llm-field-desc" }, description),
    h("select", {
      id: fieldKey,
      class: "llm-select-input",
      value,
      onChange: (e: Event) => onChange(fieldKey, (e.target as HTMLSelectElement).value),
    },
      h("option", { value: "" }, "Any loaded model"),
      [...extra, ...models].map((m) =>
        h("option", { key: m, value: m }, m),
      ),
    ),
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

// ── Claude / Codex settings card ──────────────────────────────────────

function VendorSection({
  vendorId,
  config,
  editValues,
  onChange,
  dirtyKeys,
}: {
  vendorId: CloudViewerVendor;
  config: VendorConfig;
  editValues: Record<string, string>;
  onChange: (key: string, v: string) => void;
  dirtyKeys: Set<string>;
}) {
  const cliName = useCliName();
  const suggestions = MODEL_SUGGESTIONS[vendorId] ?? [];
  const modelKey = `${vendorId}.model`;
  const lightKey = `${vendorId}.lightModel`;

  return h("div", { class: "llm-vendor-section" },
    h(ModelField, {
      fieldKey: modelKey,
      label: "Primary model",
      description: `Used for agentic tasks (${cliName} work, ${cliName} plan). Leave blank for the CLI default.`,
      value: editValues[modelKey] ?? config.model ?? "",
      suggestions,
      onChange,
      dirty: dirtyKeys.has(modelKey),
    }),
    h(ModelField, {
      fieldKey: lightKey,
      label: "Light model",
      description: "Cheaper model for recommendations and summaries. Falls back to primary if blank.",
      value: editValues[lightKey] ?? config.lightModel ?? "",
      suggestions,
      onChange,
      dirty: dirtyKeys.has(lightKey),
    }),
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
  const liveModels = localStatus?.ok && localStatus.models.length > 0 ? localStatus.models : [];

  const host  = editValues["local.host"]       ?? config.host              ?? "localhost";
  const port  = editValues["local.port"]       ?? (config.port !== null ? String(config.port) : "1234");
  const model = editValues["local.model"]      ?? config.model             ?? "";
  const light = editValues["local.lightModel"] ?? config.lightModel        ?? "";

  const connDirty = dirtyKeys.has("local.host") || dirtyKeys.has("local.port");

  // Model field — select when live list available, text input otherwise
  const primaryField = liveModels.length > 0
    ? h(ModelSelect, {
        fieldKey: "local.model",
        label: "Primary model",
        description: "Model used for agentic tasks. Leave blank to use any loaded model.",
        value: model,
        models: liveModels,
        onChange,
        dirty: dirtyKeys.has("local.model"),
      })
    : h(ModelField, {
        fieldKey: "local.model",
        label: "Primary model",
        description: "Leave blank to use whichever model is currently loaded.",
        value: model,
        suggestions: [],
        onChange,
        dirty: dirtyKeys.has("local.model"),
        placeholder: "model-id",
      });

  const lightField = liveModels.length > 0
    ? h(ModelSelect, {
        fieldKey: "local.lightModel",
        label: "Light model",
        description: "Cheaper model for briefs and estimates. Falls back to primary if blank.",
        value: light,
        models: liveModels,
        onChange,
        dirty: dirtyKeys.has("local.lightModel"),
      })
    : h(ModelField, {
        fieldKey: "local.lightModel",
        label: "Light model",
        description: "Falls back to primary if blank.",
        value: light,
        suggestions: [],
        onChange,
        dirty: dirtyKeys.has("local.lightModel"),
        placeholder: "model-id",
      });

  return h("div", { class: "llm-vendor-section" },

    // ── Status pill (always first)
    h("div", { class: "llm-local-top" },
      h(StatusPill, { status: localStatus, onRefresh: onRefreshStatus }),
    ),

    // ── Model selection (right after status — most important action when connected)
    h("p", { class: "llm-section-sub" },
      liveModels.length > 0
        ? `Model — select from ${liveModels.length} available`
        : "Model",
    ),
    primaryField,
    lightField,

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

    // ── Profiles
    h("p", { class: "llm-section-sub" }, "Saved profiles"),
    h(ProfilesPanel, {
      currentValues: { host, port, model },
      onChange,
    }),
  );
}

// ── Toast ─────────────────────────────────────────────────────────────

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

function SaveToast({ message }: { message: string | null }) {
  if (!message) return null;
  return h("div", { class: "llm-toast", role: "status", "aria-live": "polite" },
    h("span", { class: "llm-toast-check" }, "✓"),
    h("span", null, message),
  );
}

// ── Main view ─────────────────────────────────────────────────────────

export function LlmProviderView() {
  const cliName = useCliName();
  const [data, setData] = useState<LlmConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editValues,  setEditValues]  = useState<Record<string, string>>({});
  const [editToggles, setEditToggles] = useState<Record<string, boolean>>({});
  const [pendingVendor, setPendingVendor] = useState<string | null | undefined>(undefined);

  const effectiveVendor = pendingVendor !== undefined ? pendingVendor : data?.vendor ?? null;
  const showLocal = effectiveVendor === VIEWER_LLM_VENDOR.LOCAL;
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
  useEffect(() => () => { if (toastRef.current) clearTimeout(toastRef.current); }, []);

  const handleVendorChange = useCallback((v: string | null) => setPendingVendor(v), []);
  const handleField  = useCallback((key: string, val: string)  => setEditValues((p)  => ({ ...p, [key]: val })), []);
  const handleToggle = useCallback((key: string, val: boolean) => setEditToggles((p) => ({ ...p, [key]: val })), []);

  // ── Dirty tracking
  const dirtyKeys = new Set<string>();
  if (data) {
    for (const vid of [VIEWER_LLM_VENDOR.CLAUDE, VIEWER_LLM_VENDOR.CODEX] as const) {
      for (const f of ["model", "lightModel"] as const) {
        const k = `${vid}.${f}`;
        if (k in editValues && editValues[k] !== (data[vid][f] ?? "")) dirtyKeys.add(k);
      }
    }
    for (const f of ["model", "lightModel", "host"] as const) {
      const k = `local.${f}`;
      if (k in editValues && editValues[k] !== (data.local[f] ?? "")) dirtyKeys.add(k);
    }
    if ("local.port" in editValues) {
      const saved = data.local.port !== null ? String(data.local.port) : "1234";
      if (editValues["local.port"] !== saved) dirtyKeys.add("local.port");
    }
  }
  const vendorDirty = pendingVendor !== undefined && pendingVendor !== (data?.vendor ?? null);

  const dirtyToggles = new Set<string>();
  if (data && "autoFailover" in editToggles && editToggles.autoFailover !== (data.autoFailover ?? false)) {
    dirtyToggles.add("autoFailover");
  }

  const hasChanges = dirtyKeys.size > 0 || vendorDirty || dirtyToggles.size > 0;
  const changeCount = dirtyKeys.size + dirtyToggles.size + (vendorDirty ? 1 : 0);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const changes: Record<string, string | null | boolean> = {};
      if (vendorDirty) changes["llm.vendor"] = pendingVendor;
      for (const key of dirtyKeys) {
        const raw = editValues[key] ?? "";
        // key is e.g. "claude.model" → api path is "llm.claude.model"
        changes[`llm.${key}`] = raw.trim() || null;
      }
      for (const key of dirtyToggles) {
        if (key === "autoFailover") changes["llm.autoFailover"] = editToggles.autoFailover;
      }
      const res = await fetch("/api/llm/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setError((body as { error?: string }).error ?? "Failed to save");
        return;
      }
      const json = await res.json() as { config: LlmConfigResponse };
      setData(json.config);
      setEditValues({});
      setEditToggles({});
      setPendingVendor(undefined);
      setToast("Saved");
      if (toastRef.current) clearTimeout(toastRef.current);
      toastRef.current = setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [vendorDirty, pendingVendor, dirtyKeys, dirtyToggles, editValues, editToggles]);

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

  const legacy = data?.legacyClaude;
  const showLegacy = legacy && (legacy.model || legacy.lightModel) && !data?.claude.model && !data?.claude.lightModel;

  return h("div", { class: "llm-container" },

    h("div", { class: "llm-header" },
      h("div", { class: "llm-header-brand" },
        h(NdxLogoPng, { size: 16, class: "llm-header-logo" }),
        h("span", { class: "llm-header-title" }, "LLM Provider"),
      ),
      h("p", { class: "llm-header-subtitle" },
        "General settings used by all LLM commands (",
        h("code", null, `${cliName} work`),
        ", ",
        h("code", null, `${cliName} plan`),
        ", ",
        h("code", null, `${cliName} recommend`),
        "). Select the active vendor and configure model IDs. ",
        "Changes are saved to ",
        h("code", null, ".n-dx.json"),
        " and take effect on the next run.",
      ),
    ),

    // ── Credential status for the configured provider
    h(AuthStatusChip, null),

    // ── Error banner
    error
      ? h("div", { class: "llm-error-banner" }, error)
      : null,

    h(VendorSelector, {
      vendor: effectiveVendor,
      onChange: handleVendorChange,
      localStatus: showLocal ? localStatus : null,
    }),

    // Active vendor settings
    (effectiveVendor === VIEWER_LLM_VENDOR.CLAUDE || effectiveVendor === VIEWER_LLM_VENDOR.CODEX)
      ? h(VendorSection, {
          key: effectiveVendor,
          vendorId: effectiveVendor,
          config: data![effectiveVendor],
          editValues,
          onChange: handleField,
          dirtyKeys,
        })
      : null,
    showLocal
      ? h(LocalSection, {
          key: VIEWER_LLM_VENDOR.LOCAL,
          config: data!.local ?? { model: null, lightModel: null, host: null, port: null },
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
            h("strong", null, "Legacy claude.* fields detected"),
            h("p", null,
              "Your ",
              h("code", null, ".n-dx.json"),
              " has legacy ",
              h("code", null, "claude.model"),
              legacy!.model ? ` (${legacy!.model})` : "",
              legacy!.lightModel ? ` / claude.lightModel (${legacy!.lightModel})` : "",
              ". Set the modern ",
              h("code", null, "llm.claude.*"),
              " fields above to override.",
            ),
          ),
        )
      : null,

    // Save / discard bar
    hasChanges
      ? h("div", { class: "llm-save-bar" },
          h("span", { class: "llm-save-hint" },
            `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}`,
          ),
          h("button", {
            class: "cmd-btn cmd-btn-secondary",
            onClick: handleDiscard,
            disabled: saving,
          }, "Discard"),
          h("button", {
            class: "cmd-btn cmd-btn-primary",
            onClick: handleSave,
            disabled: saving,
          }, saving ? "Saving…" : "Save"),
        )
      : null,

    h(SaveToast, { message: toast }),
  );
}
