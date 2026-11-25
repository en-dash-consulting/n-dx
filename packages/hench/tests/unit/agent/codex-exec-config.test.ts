import { describe, expect, it } from "vitest";
import { projectCodexExecConfig } from "../../../src/agent/lifecycle/codex-exec-config.js";
import { fixtureSystemLayer } from "../../helpers/codex-system-layer.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

function layer(type: string, config = {}, extra = {}) {
  const file = type === "system" ? fixtureSystemLayer.name.file : "/fixture/config.toml";
  return { name: { type, file, dotCodexFolder: "/fixture/.codex", profile: null as string | null }, version: "fixture", config, ...extra };
}
function snapshot(config: Record<string, unknown> = {}) {
  return { config, requirements: null, userAgent: "n-dx/0.167.0-alpha.3.2 (test)",
    layers: [layer("user", config), layer("system")] };
}
const provider = { name: "Company", base_url: "https://company.example/v1", wire_api: "responses", requires_openai_auth: false, env_key: "COMPANY_TOKEN", supports_websockets: false };

describe("isolated Codex exec admission", () => {
  it("preserves original login selection, workspace restriction and confinement without credentials", async () => {
    const config = { model: "gpt-6-astra", forced_login_method: "chatgpt", forced_chatgpt_workspace_id: "workspace-id",
      cli_auth_credentials_store: "keyring", sandbox_mode: "workspace-write", approval_policy: "never",
      sandbox_workspace_write: { writable_roots: ["/assigned"], network_access: false },
      shell_environment_policy: { inherit: "all", include_only: ["PATH", "TMPDIR"], exclude: ["SECRET"] } };
    const env = { HOME: "/original", CODEX_HOME: "/original-codex", PRIVATE: "credential-canary" };
    const before = structuredClone(env);
    const flags = await projectCodexExecConfig(snapshot(config), env);
    expect(flags).toContain('model="gpt-6-astra"');
    expect(flags).toContain('forced_login_method="chatgpt"');
    expect(flags).toContain('forced_chatgpt_workspace_id="workspace-id"');
    expect(flags).toContain('cli_auth_credentials_store="keyring"');
    expect(flags.join(" ")).toContain('"network_access"=false');
    expect(flags.join(" ")).not.toContain("credential-canary");
    expect(env).toEqual(before);
  });

  it("keeps an explicitly selected environment-authenticated provider with no fallback", async () => {
    const flags = await projectCodexExecConfig(snapshot({ model_provider: "company", model_providers: { company: provider } }), { COMPANY_TOKEN: "credential-canary" });
    expect(flags).toContain('model_provider="company"');
    expect(flags).toContain('model_providers.company.env_key="COMPANY_TOKEN"');
    expect(flags.join(" ")).not.toContain("credential-canary");
  });

  it.each([undefined, {}, [], { allowed_sandbox_modes: ["read-only"] }])("never treats unknown/non-null requirements as unmanaged: %j", async requirements => {
    await expect(projectCodexExecConfig({ ...snapshot(), requirements }, {})).rejects.toThrow(/managed requirements/);
  });
  it("requires the own requirements field", async () => {
    const { requirements: _requirements, ...missing } = snapshot();
    await expect(projectCodexExecConfig(missing, {})).rejects.toThrow(/own requirements/);
  });
  it.each(["mdm", "enterpriseManaged", "legacyManagedConfigTomlFromFile", "legacyManagedConfigTomlFromMdm", "system", "packagedDefaults", "unknown"])("refuses unproven %s layers even with null requirements", async type => {
    const value = snapshot();
    value.layers.push(layer(type, { approval_policy: "never" }));
    await expect(projectCodexExecConfig(value, {})).rejects.toThrow(/configuration/);
  });
  it.each([undefined, [], [{}], [layer("user")], [fixtureSystemLayer]])("refuses missing/malformed provenance: %j", async layers => {
    await expect(projectCodexExecConfig({ ...snapshot(), layers }, {})).rejects.toThrow(/metadata/);
  });
  it.each(["system", "packagedDefaults"])("refuses an empty %s source beneath a writable ancestor", async type => {
    const value = snapshot();
    const source = layer(type);
    source.name.file = join(tmpdir(), "missing-system-dir", "config.toml");
    value.layers.push(source);
    await expect(projectCodexExecConfig(value, {})).rejects.toThrow(/administrator-only control/);
  });
  it("allows disabled project settings and positively active MCP-only projects", async () => {
    const value = snapshot();
    value.layers.push(layer("project", { hooks: "never-evaluate" }, { disabledReason: "untrusted" }), layer("project", { mcp_servers: { foreign: {} } }));
    expect(await projectCodexExecConfig(value, {})).toContain('model_provider="openai"');
  });
  it.each(["hooks", "notify", "permissions", "default_permissions", "profile", "openai_base_url", "unknown"])("refuses explicit %s instead of silently dropping it", async key => {
    await expect(projectCodexExecConfig(snapshot({ [key]: "private-canary" }), {})).rejects.toThrow(/unsupported/);
  });
  it("refuses a native profile and a project-owned provider", async () => {
    const value = snapshot();
    value.layers[0].name.profile = "company";
    await expect(projectCodexExecConfig(value, {})).rejects.toThrow(/profile/);
    await expect(projectCodexExecConfig({ ...snapshot(), layers: [layer("user"), layer("project", { model_provider: "foreign" })] }, {})).rejects.toThrow(/project/);
  });
  it.each(["http_headers", "experimental_bearer_token", "auth", "gateway_oauth", "credential_file", "helper", "unknown"])("refuses provider %s without evaluating/printing its value", async key => {
    await expect(projectCodexExecConfig(snapshot({ model_provider: "company", model_providers: { company: { ...provider, [key]: "private-canary" } } }), { COMPANY_TOKEN: "credential-canary" })).rejects.toThrow(/unsupported/);
  });
  it("checks raw selected provider keys even when native normalization omits them", async () => {
    const value = snapshot({ model_provider: "company", model_providers: { company: provider } });
    value.layers[0].config = { model_providers: { company: { ...provider, credential_helper: "never-evaluate" } } };
    await expect(projectCodexExecConfig(value, { COMPANY_TOKEN: "private-canary" })).rejects.toThrow(/unsupported raw settings/);
  });
  it.each([{ model_provider: "missing" }, { model_provider: "company", model_providers: { company: { ...provider, base_url: "https://secret@company.example" } } }, { shell_environment_policy: { set: { TOKEN: "credential-canary" } } }])("refuses unprojectable settings", async config => {
    await expect(projectCodexExecConfig(snapshot(config), {})).rejects.toThrow(/Codex MCP binding refused/);
  });
  it("requires the verified native executor version", async () => {
    await expect(projectCodexExecConfig({ ...snapshot(), userAgent: "n-dx/unknown" }, {})).rejects.toThrow(/verified ignore-user-config/);
  });
});
