/** Selected user-owned provider only. Never load repository config or execute auth helpers. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { codexConfigAssignments, codexUserConfigPath, compileEnvPolicy, envNameAllowed, execFileSyncCli, isModelCompatibleWithVendor, resolveVendorCliEnv } from "@n-dx/llm-client";
import type { CodexTurnFlags, EnvPolicyConfig, RuntimeEvent, VendorSession, VendorSessionOptions } from "@n-dx/llm-client";

const unsupported = (detail: string): never => {
  throw new Error(`Unsupported Codex Sidecar provider capability: ${detail}. Use a Responses provider with environment-backed authentication.`);
};
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY = /^[A-Za-z0-9_-]+$/;

function string(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (/^'[^'\x00-\x1f\x7f]*'$/.test(raw)) return raw.slice(1, -1);
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "string" && !/[\x00-\x1f\x7f]/.test(value)) return value;
  } catch { return unsupported("a selected setting is not a supported single-line string"); }
  return unsupported("a selected setting is not a supported single-line string");
}

export interface SidecarCodexProvider {
  provider: string;
  model?: string;
  flags: string[];
  env: Record<string, string>;
  /** Original names must be removed even when their spelling passes the general env filter. */
  sourceNames: string[];
  hasStaticCredentials: boolean;
  identity: string;
  redact<T>(value: T): T;
}

export function readSidecarCodexProvider(
  env: NodeJS.ProcessEnv = process.env,
  policy?: EnvPolicyConfig,
  credentials: NodeJS.ProcessEnv = process.env,
): SidecarCodexProvider {
  let values: Map<string, string>;
  try {
    values = codexConfigAssignments(readFileSync(codexUserConfigPath(env), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") values = new Map();
    else return unsupported("the user config could not be read with confidence");
  }
  const get = (...path: string[]) => values.get(JSON.stringify(path));
  const profile = string(get("profile"));
  const selected = (key: string) => (profile !== undefined ? get("profiles", profile, key) : undefined) ?? get(key);
  if (profile !== undefined && ![...values.keys()].some(key => {
    const path: string[] = JSON.parse(key);
    return path[0] === "profiles" && path[1] === profile;
  })) return unsupported("the selected profile is missing");
  const provider = string(selected("model_provider")) ?? "openai";
  const model = string(selected("model"));
  if (!KEY.test(provider)) return unsupported("the provider id must be a bare TOML key");
  const flags: string[] = ["-c", `model_provider=${JSON.stringify(provider)}`];
  const secretEnv: Record<string, string> = {};
  const sourceNames: string[] = [];
  const secrets: string[] = [];
  const put = (key: string, value: string | number | boolean) => flags.push("-c", `model_providers.${provider}.${key}=${JSON.stringify(value)}`);
  const secret = (value: string): string => {
    if (!value || /[\r\n\x00]/.test(value)) throw new Error("Codex Sidecar provider missing auth: export a non-empty, single-line provider credential before starting the server.");
    const name = `NDX_SIDECAR_PROVIDER_${secrets.length}`;
    secretEnv[name] = value;
    secrets.push(value);
    return name;
  };
  const fromEnv = (name: string): string => {
    if (!ENV_NAME.test(name) || /^(NDX_|CODEX_HOME$|PATH$|HOME$)/i.test(name)) return unsupported("reserved or invalid credential variable");
    // Explicit operator denials win. The selected user config authorizes this exact name only.
    const filtered = compileEnvPolicy({ ...policy, allow: [...(policy?.allow ?? []), name] });
    if (!envNameAllowed(name, filtered)) throw new Error("Codex Sidecar provider missing auth: the selected credential is denied by the environment policy.");
    sourceNames.push(name);
    if (!credentials[name]) throw new Error(`Codex Sidecar provider missing auth: export ${name} before starting the server.`);
    return secret(credentials[name] ?? "");
  };
  const entries = [...values].map(([key, raw]) => ({ path: JSON.parse(key) as string[], raw }))
    .filter(({ path }) => path[0] === "model_providers" && path[1] === provider);
  if (provider === "openai") {
    if (entries.length) return unsupported("overriding the built-in OpenAI provider; select a named custom provider instead");
  } else {
    const field = (key: string) => get("model_providers", provider, key);
    const base = string(field("base_url"));
    if (!base) return unsupported("the selected provider has no base_url");
    let url: URL;
    try { url = new URL(base); } catch { return unsupported("invalid provider base_url"); }
    if (url.username || url.password || url.search || url.hash
        || !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
      return unsupported("base_url must use HTTPS (or loopback HTTP), without credentials, query or fragment");
    }
    if ((string(field("wire_api")) ?? "responses") !== "responses") return unsupported("only Responses wire_api is supported");
    if (field("requires_openai_auth") && field("requires_openai_auth") !== "false") return unsupported("custom-provider OpenAI login/OAuth");
    if (field("env_key") && field("experimental_bearer_token")) return unsupported("multiple bearer credential sources");
    put("name", "Sidecar selected provider");
    put("base_url", base);
    put("wire_api", "responses");
    put("requires_openai_auth", false);
    const headers = new Map<string, string>();
    const allowed = new Set(["name", "base_url", "wire_api", "requires_openai_auth", "env_key", "env_key_instructions", "experimental_bearer_token", "http_headers", "env_http_headers", "query_params", "request_max_retries", "stream_max_retries", "stream_idle_timeout_ms", "supports_websockets"]);
    for (const { path, raw } of entries) {
      const key = path[2];
      if (path.length === 2 && raw.startsWith("{")) continue;
      if (!key || !allowed.has(key)) return unsupported("the selected provider contains an unsupported setting (including auth helpers or OAuth)");
      if (path.length === 3) {
        if (key === "env_key") put("env_key", fromEnv(string(raw)!));
        else if (key === "experimental_bearer_token") put("env_key", secret(string(raw)!));
        else if (["request_max_retries", "stream_max_retries", "stream_idle_timeout_ms"].includes(key)) {
          if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) return unsupported("invalid retry or timeout setting");
          put(key, Number(raw));
        } else if (key === "supports_websockets") {
          if (!["true", "false"].includes(raw)) return unsupported("invalid websocket setting");
          put(key, raw === "true");
        } else if (["http_headers", "env_http_headers", "query_params"].includes(key) && !raw.startsWith("{")) return unsupported("invalid provider map");
      } else if (path.length === 4 && ["http_headers", "env_http_headers"].includes(key)) {
        const header = path[3];
        if (!/^[A-Za-z0-9-]+$/.test(header) || /^(host|content-length|connection|x-ndx-.*)$/i.test(header) || headers.has(header.toLowerCase())) return unsupported("reserved or duplicate provider header");
        headers.set(header.toLowerCase(), key === "http_headers" ? secret(string(raw)!) : fromEnv(string(raw)!));
      } else if (path.length === 4 && key === "query_params" && path[3] === "api-version") {
        const version = string(raw)!;
        if (!/^[0-9-]+(?:-preview)?$/.test(version)) return unsupported("only a non-secret api-version query parameter is supported");
        flags.push("-c", `model_providers.${provider}.query_params={"api-version"=${JSON.stringify(version)}}`);
      } else return unsupported("unsupported nested provider setting");
    }
    if (headers.has("authorization") && (field("env_key") || field("experimental_bearer_token"))) return unsupported("multiple authorization header sources");
    if (headers.size) flags.push("-c", `model_providers.${provider}.env_http_headers={${[...headers].map(([key, name]) => `${JSON.stringify(key)}=${JSON.stringify(name)}`).join(",")}}`);
  }
  // No credential can accidentally become argv through another selected field.
  if (secrets.some(value => flags.some(flag => flag.includes(value)) || model?.includes(value))) return unsupported("a credential overlaps a public provider setting");
  const identity = createHash("sha256").update(JSON.stringify([provider, model, flags, secretEnv])).digest("hex");
  return { provider, model, flags, env: secretEnv, sourceNames, identity,
    hasStaticCredentials: secrets.length > sourceNames.length,
    redact<T>(value: T): T {
      if (!secrets.length) return value;
      const scrub = (input: unknown): unknown => {
        if (typeof input === "string") {
          let clean = input;
          for (const secret of [...secrets].sort((a, b) => b.length - a.length)) clean = clean.split(secret).join("[provider credential]");
          return clean;
        }
        if (Array.isArray(input)) return input.map(scrub);
        if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, item]) => [scrub(key), scrub(item)]));
        return input;
      };
      return scrub(value) as T;
    },
  };
}

/** Never echo a provider response body, URL, auth header or helper diagnostic. */
export function sidecarProviderFailure(message: string): string {
  if (/^(?:401|403)\b|\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?: code)?)\s*[:=]?\s*(?:401|403)\b|unauthori[sz]ed|forbidden|authentication|invalid.api.key/i.test(message)) return "Codex Sidecar provider missing auth or rejected credentials: check the selected provider auth configuration and credential source, and confirm the provider server is available. No fallback was attempted.";
  if (/unknown field|unexpected argument|unsupported|unrecognized|invalid.*config/i.test(message)) return "Unsupported Codex Sidecar CLI/provider capability: check the selected binary and Responses provider settings.";
  return "Codex Sidecar provider connection failure: check the selected endpoint, network and model availability. No fallback was attempted.";
}

/** Apply the selected provider without letting its credentials reach CLI probes or shell tools. */
export function sidecarProviderConnection(
  settings: Pick<VendorSessionOptions, "llmConfig" | "envPolicy" | "env" | "binary">,
  spawn: { codex: CodexTurnFlags; env: Record<string, string> },
  cwd: string,
  scope: "worktree" | "hub",
  sessionModel?: string,
): VendorSessionOptions & { provider: SidecarCodexProvider } {
  const provider = readSidecarCodexProvider(settings.env ?? process.env, settings.envPolicy);
  const custom = provider.provider !== "openai";
  if (scope === "worktree" && provider.hasStaticCredentials) {
    return unsupported("worktree shells can read static credentials in config.toml; use env_key or env_http_headers");
  }
  const llmConfig = settings.llmConfig;
  const model = sessionModel ?? llmConfig?.codex?.model ?? provider.model;
  if (model !== undefined && (!isModelCompatibleWithVendor("codex", model) || provider.redact(model) !== model)) {
    return unsupported("the effective model is not a supported public Codex model pin");
  }
  const env = { ...(settings.env ?? resolveVendorCliEnv(custom
    ? { ...llmConfig, vendor: "codex", codex: { ...llmConfig?.codex, auth: "cli" } }
    : { ...llmConfig, vendor: "codex" }, settings.envPolicy)) };
  for (const name of Object.keys(env)) {
    if (provider.sourceNames.some(source => source.toUpperCase() === name.toUpperCase())
      || Object.values(provider.env).includes(env[name] ?? "")
      || (custom && /^(OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN)$/i.test(name))) delete env[name];
  }
  const binary = settings.binary ?? llmConfig?.codex?.cli_path ?? "codex";
  if (custom) {
    let version: string;
    try { version = execFileSyncCli(binary, ["--version"], { env, cwd, timeout: 5_000, encoding: "utf8" }).toString().trim(); }
    catch { return unsupported("the selected CLI could not be verified"); }
    if (version !== "codex-cli 0.167.0-alpha.3.2") return unsupported("custom providers require the verified codex-cli 0.167.0-alpha.3.2");
  }
  return {
    ...settings, vendor: "codex", cwd, binary, env, provider,
    model,
    extraEnv: { ...spawn.env, ...provider.env },
    codex: { ...spawn.codex,
      configFlags: [...(spawn.codex.configFlags ?? []), ...provider.flags],
      hiddenEnv: [...(spawn.codex.hiddenEnv ?? []), ...provider.sourceNames, ...Object.keys(provider.env)],
      turnConfigFlags: () => {
        if (readSidecarCodexProvider(settings.env ?? process.env, settings.envPolicy).identity !== provider.identity) {
          throw new Error("Codex Sidecar provider settings/auth changed during turn preparation; retry the turn");
        }
        return spawn.codex.turnConfigFlags?.() ?? [];
      },
    },
  };
}

export function providerEvent(provider: SidecarCodexProvider | undefined, event: RuntimeEvent): RuntimeEvent {
  if (!provider || provider.provider === "openai") return event;
  const clean = provider.redact(event);
  if (clean.failure) return { ...clean, failure: { ...clean.failure, message: sidecarProviderFailure(clean.failure.message) } };
  return clean;
}

/** Sanitize results before the registry, ledger or HTTP error handler can persist them. */
export function protectProviderSession(session: VendorSession, provider?: SidecarCodexProvider): VendorSession {
  if (!provider || provider.provider === "openai") return session;
  return {
    get vendor() { return session.vendor; },
    get state() { return session.state; },
    get turns() { return session.turns; },
    get sessionId() { return session.sessionId; },
    interrupt: () => session.interrupt(), end: () => session.end(),
    async sendTurn(prompt) {
      const result = provider.redact(await session.sendTurn(prompt));
      return { ...result, events: result.events.map(event => providerEvent(provider, event)),
        ...(result.error && { error: sidecarProviderFailure(result.error) }) };
    },
  };
}
