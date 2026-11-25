/** Narrow admission for exec --ignore-user-config. Never copy credentials or
 * reconstruct unknown policy. config/read inspects the ORIGINAL configuration;
 * it cannot verify the ignored exec invocation. */
import { isAbsolute } from "node:path";
import { isProtectedCodexConfig } from "./codex-system-config.js";

function configRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function refuse(detail: string): never {
  throw new Error(`Codex MCP binding refused: ${detail}. The selected configuration cannot be preserved by isolated exec; use a supported configuration or retain this run as blocked. No executor was started.`);
}

const publicString = (value: unknown): value is string => typeof value === "string" && !/[\x00-\x1f\x7f]/.test(value);
const strings = (value: unknown): boolean => Array.isArray(value) && value.every(publicString);
const choices = (...values: unknown[]) => (value: unknown) => values.includes(value);
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const scalar: Record<string, (value: unknown) => boolean> = {
  model: value => publicString(value) && /^[A-Za-z0-9._:/-]+$/.test(value),
  model_reasoning_effort: choices("none", "minimal", "low", "medium", "high", "xhigh", "max"),
  model_reasoning_summary: choices("auto", "concise", "detailed", "none"),
  model_verbosity: choices("low", "medium", "high"),
  service_tier: choices("auto", "default", "flex", "priority", "fast"),
  approval_policy: choices("untrusted", "on-failure", "on-request", "never"),
  sandbox_mode: choices("read-only", "workspace-write", "danger-full-access"),
  forced_login_method: choices("chatgpt", "api"),
  forced_chatgpt_workspace_id: value => publicString(value) && /^[a-zA-Z0-9-]+$/.test(value),
  cli_auth_credentials_store: choices("file", "keyring", "auto", "ephemeral"),
  web_search: choices("disabled", "cached", "live"),
  allow_login_shell: value => typeof value === "boolean",
  project_doc_max_bytes: integer,
  project_doc_fallback_filenames: strings,
  model_context_window: integer,
  model_auto_compact_token_limit: integer,
};
// Excluded tools, trust registrations (no project config is loaded), or UI only.
const omitted = new Set(["mcp_servers", "apps", "plugins", "marketplaces", "projects", "tui", "notice", "feedback", "check_for_update_on_startup", "suppress_unstable_features_warning"]);
const complex = new Set(["model_provider", "model_providers", "features", "shell_environment_policy", "sandbox_workspace_write"]);
const featureNames = new Set(["apps", "plugins", "shell_snapshot"]);
const providerFields = new Set(["name", "base_url", "wire_api", "env_key", "requires_openai_auth", "supports_websockets", "supports_standalone_web_search", "request_max_retries", "stream_max_retries", "stream_idle_timeout_ms"]);

function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  const table = configRecord(value);
  if (table) return `{${Object.entries(table).filter(([, v]) => v != null).map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function projectCodexExecConfig(snapshot: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<string[]> {
  if (typeof snapshot.userAgent !== "string" || !/\/0\.167\.0-alpha\.3\.2(?:\s|$)/.test(snapshot.userAgent)) {
    refuse("the selected CLI has no verified ignore-user-config executor contract (supported: 0.167.0-alpha.3.2)");
  }
  if (!Object.hasOwn(snapshot, "requirements")) refuse("configRequirements/read omitted its own requirements field");
  if (snapshot.requirements !== null) refuse("managed requirements are present or unknown; their preservation is not verified");
  const config = configRecord(snapshot.config);
  if (!config || !Array.isArray(snapshot.layers) || snapshot.layers.length === 0) refuse("native configuration layer metadata is missing");
  const provider = config.model_provider ?? "openai";
  if (typeof provider !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(provider)) refuse("invalid selected provider id");
  let user = false;
  let system = false;
  for (const entry of snapshot.layers) {
    const layer = configRecord(entry);
    const name = configRecord(layer?.name);
    const values = configRecord(layer?.config);
    if (!layer || !name || !values || typeof layer.version !== "string") refuse("native configuration layer metadata is malformed");
    const type = name.type;
    if (!["packagedDefaults", "system", "mdm", "enterpriseManaged", "legacyManagedConfigTomlFromFile", "legacyManagedConfigTomlFromMdm", "user", "project", "sessionFlags"].includes(String(type))) refuse("native configuration has an unknown layer source");
    if (["user", "system", "packagedDefaults"].includes(String(type)) &&
        (typeof name.file !== "string" || !isAbsolute(name.file))) refuse("native configuration layer file metadata is missing");
    if (type === "project" && (typeof name.dotCodexFolder !== "string" || !isAbsolute(name.dotCodexFolder))) refuse("native project layer metadata is missing");
    if (layer.disabledReason != null && typeof layer.disabledReason !== "string") refuse("native layer disabledReason is malformed");
    // A disabled managed layer still names an unproven policy mechanism.
    if (!["user", "project", "sessionFlags"].includes(String(type))) {
      if (type !== "system" && type !== "packagedDefaults" || Object.keys(values).length > 0) refuse(`nonempty or unsupported ${type} configuration cannot be preserved`);
      if (!await isProtectedCodexConfig(name.file as string)) refuse(`cannot verify administrator-only control of the ${type} configuration file and its ancestors`);
      if (type === "system") system = true;
      continue;
    }
    if (type === "user") {
      user = true;
      if (!Object.hasOwn(name, "profile")) refuse("native user profile metadata is missing");
      if (name.profile != null) refuse("native profile selection is not verified for isolated exec");
    }
    if (layer.disabledReason != null) continue;
    for (const key of Object.keys(values)) {
      if (type === "project" && key !== "mcp_servers") refuse("active project settings beyond MCP registrations cannot be safely projected");
      if (!Object.hasOwn(scalar, key) && !omitted.has(key) && !complex.has(key)) refuse("an explicit native setting is unsupported (profile, hooks, helpers and unknown settings are not evaluated)");
      if (key === "features") {
        const features = configRecord(values.features);
        if (!features || Object.keys(features).some(key => !featureNames.has(key))) refuse("explicit native feature settings are unsupported");
      }
      if (key === "model_providers") {
        const providers = configRecord(values.model_providers);
        const selected = configRecord(providers?.[provider]);
        if (!providers || (Object.hasOwn(providers, provider) && !selected) ||
            selected && (provider === "openai" || Object.keys(selected).some(key => !providerFields.has(key)))) {
          refuse("selected provider has unsupported raw settings; helpers and unknown credentials are not evaluated");
        }
      }
    }
  }
  if (!user) refuse("native user-layer metadata is missing");
  if (!system) refuse("native system-layer file metadata is missing");
  const flags: string[] = [];
  const put = (key: string, value: unknown) => flags.push("-c", `${key}=${toml(value)}`);
  for (const [key, valid] of Object.entries(scalar)) {
    const value = config[key];
    if (value != null) {
      if (!valid(value)) refuse(`unsupported ${key} setting`);
      put(key, value);
    }
  }
  const workspace = configRecord(config.sandbox_workspace_write);
  if (config.sandbox_workspace_write != null && !workspace) refuse("invalid workspace sandbox settings");
  if (workspace) {
    for (const [key, value] of Object.entries(workspace)) {
      if (value == null) continue;
      if (key === "writable_roots" ? !strings(value) : !["network_access", "exclude_tmpdir_env_var", "exclude_slash_tmp"].includes(key) || typeof value !== "boolean") refuse("unsupported workspace sandbox controls");
    }
    put("sandbox_workspace_write", workspace);
  }
  const shell = configRecord(config.shell_environment_policy);
  if (config.shell_environment_policy != null && !shell) refuse("invalid shell environment policy");
  if (shell) {
    for (const [key, value] of Object.entries(shell)) {
      if (value == null) continue;
      if (key === "set") {
        const set = configRecord(value);
        if (!set || Object.entries(set).some(([name, val]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || (val !== "" && (!["TMPDIR", "TMP", "TEMP"].includes(name) || !publicString(val) || val !== env[name])))) refuse("shell environment set contains unverified values; credentials cannot be projected into argv");
      } else if (key === "inherit") {
        if (!["all", "core", "none"].includes(String(value))) refuse("unsupported shell inheritance");
      } else if (["exclude", "include_only"].includes(key)) {
        if (!strings(value)) refuse("unsupported shell environment filters");
      } else if (key !== "ignore_default_excludes" || typeof value !== "boolean") refuse("unsupported shell environment policy mechanism");
    }
    for (const [key, value] of Object.entries(shell)) {
      if (value == null) continue;
      if (key === "set") {
        for (const [name, item] of Object.entries(configRecord(value)!)) put(`shell_environment_policy.set.${name}`, item);
      } else put(`shell_environment_policy.${key}`, value);
    }
  }
  put("model_provider", provider);
  const providers = configRecord(config.model_providers);
  const selected = configRecord(providers?.[provider]);
  if (provider === "openai") {
    if (selected && Object.keys(selected).length) refuse("overriding the built-in login provider is unsupported");
  } else {
    if (!selected) refuse("selected provider definition is missing; no OpenAI fallback is allowed");
    if (Object.entries(selected).some(([key, value]) => value != null && !providerFields.has(key))) refuse("selected provider uses unsupported credentials, headers, OAuth, helpers or settings");
    if (!publicString(selected.base_url)) refuse("selected provider base_url is missing");
    let url: URL;
    try { url = new URL(selected.base_url); } catch { return refuse("invalid selected provider URL"); }
    if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) refuse("selected provider URL is not a credential-free HTTPS or loopback endpoint");
    if (selected.wire_api !== "responses" || selected.requires_openai_auth !== false) refuse("selected provider requires unsupported wire or login semantics");
    if (!publicString(selected.name)) refuse("selected provider name is missing");
    for (const [key, value] of Object.entries(selected)) {
      if (value == null) continue;
      if (key === "env_key") {
        if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || /^(NDX_|CODEX_|HOME$|PATH$)/i.test(value) || !env[value]) refuse("selected provider credential variable is invalid or unavailable in the admitted environment");
      } else if (["request_max_retries", "stream_max_retries", "stream_idle_timeout_ms"].includes(key) && !integer(value)) refuse("selected provider retry settings are invalid");
      else if (["supports_websockets", "supports_standalone_web_search"].includes(key) && typeof value !== "boolean") refuse("selected provider capability setting is invalid");
      put(`model_providers.${provider}.${key}`, value);
    }
  }
  // Never leak an environment-backed selected credential through another field.
  const secret = typeof selected?.env_key === "string" ? env[selected.env_key] : undefined;
  if (secret && flags.some(flag => flag.includes(secret))) refuse("selected credential overlaps public configuration");
  return flags;
}
