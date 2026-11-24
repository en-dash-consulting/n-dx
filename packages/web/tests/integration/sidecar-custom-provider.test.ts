/** Contract fixtures only; native CLI/HTTP acceptance is the standalone host probe. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { codexConfigAssignments, type VendorSessionOptions } from "@n-dx/llm-client";
import { readSidecarCodexProvider, sidecarProviderFailure } from "../../src/server/sidecar/codex-provider.js";
import { SidecarSessionRegistry, sidecarSessionConnect } from "../../src/server/sidecar/session-registry.js";

const fixture = vi.hoisted(() => ({ model: undefined as string | undefined, binary: "selected-codex", version: "codex-cli 0.167.0-alpha.3.2", spawn: vi.fn(), probe: vi.fn() }));
vi.mock("../../src/server/sidecar/session-env.js", () => ({
  resolveSidecarSessionEnv: async () => ({ llmConfig: { codex: { cli_path: fixture.binary, model: fixture.model } } }),
}));
vi.mock("@n-dx/llm-client", async (original) => {
  const actual = await original<typeof import("@n-dx/llm-client")>();
  return { ...actual,
    execFileSyncCli: (...args: unknown[]) => { fixture.probe(...args); return fixture.version; },
    startVendorSession: (opts: VendorSessionOptions) => actual.startVendorSession({ ...opts, spawn: fixture.spawn }),
    resumeVendorSession: (id: string, opts: VendorSessionOptions) => actual.resumeVendorSession(id, { ...opts, spawn: fixture.spawn }),
  };
});
let root: string;
let home: string;
const canary = "disposable-provider-canary-4321";
const header = "disposable-header-canary-9876";
const config = `model_provider = "fixture"
model = "gpt-6-astra"
[model_providers.fixture]
name = "fixture"
base_url = "http://127.0.0.1:3444/v1"
wire_api = "responses"
env_key = "PROVIDER_PASSWORD"
env_http_headers = { "X-Fixture" = "HEADER_CREDENTIAL" }
[mcp_servers.unrelated]
command = "never-run"
[features]
apps = true
shell_snapshot = true
`;
function write(text = config) { writeFileSync(join(home, "config.toml"), text); }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "provider-contract-"));
  home = join(root, "user"); mkdirSync(home); mkdirSync(join(root, ".git"));
  vi.stubEnv("CODEX_HOME", home);
  vi.stubEnv("PROVIDER_PASSWORD", canary);
  vi.stubEnv("HEADER_CREDENTIAL", header);
  vi.stubEnv("ALTERNATE_PROVIDER_VALUE", canary);
  fixture.model = undefined; fixture.version = "codex-cli 0.167.0-alpha.3.2";
  fixture.spawn.mockReset(); fixture.probe.mockClear();
  fixture.spawn.mockImplementation((_binary, _args, _opts) => {
    const child = new EventEmitter();
    const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr, pid: undefined, exitCode: null, signalCode: null });
    stdin.on("finish", () => {
      stdout.end(JSON.stringify({ type: "thread.started", thread_id: "provider-thread" }) + "\n"
        + JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: `answer ${canary} ${header}` } }) + "\n");
      setImmediate(() => { child.emit("exit", 0, null); child.emit("close", 0, null); });
    });
    return child as ChildProcess;
  });
  write();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

it("scans quoted/dotted/inline settings without evaluating helpers", () => {
  const values = codexConfigAssignments('model_providers = { fixture = { env_http_headers = { "X-Test" = "KEY" } } }');
  expect(values.get(JSON.stringify(["model_providers", "fixture", "env_http_headers", "X-Test"]))).toBe('"KEY"');
  expect(() => codexConfigAssignments('model_provider="one"\nmodel_provider="two"')).toThrow(/Duplicate/);
});

it("copies only the selected provider, masks every credential, and retains no integration settings", () => {
  const selected = readSidecarCodexProvider();
  expect(selected.provider).toBe("fixture");
  expect(selected.model).toBe("gpt-6-astra");
  expect(selected.env).toEqual({ NDX_SIDECAR_PROVIDER_0: canary, NDX_SIDECAR_PROVIDER_1: header });
  expect(selected.flags.join(" ")).not.toMatch(/unrelated|never-run|apps|shell_snapshot|disposable/);
  expect(selected.redact({ text: canary + header })).toEqual({ text: "[provider credential][provider credential]" });
});

it("selected profile overrides top-level provider/model without loading profile permissions", () => {
  write(`profile="selected"\n${config}\n[profiles.selected]\nmodel_provider="second"\nmodel="gpt-6.2-astra"\nsandbox_mode="danger-full-access"\n[model_providers.second]\nbase_url="https://example.invalid/v1"\n`);
  const selected = readSidecarCodexProvider();
  expect(selected.provider).toBe("second"); expect(selected.model).toBe("gpt-6.2-astra");
  expect(selected.flags.join(" ")).not.toMatch(/fixture|sandbox|danger/);
});

it("translates static headers and bearer tokens into hidden environment references", () => {
  write(config.replace('env_key = "PROVIDER_PASSWORD"', `experimental_bearer_token = "${canary}"`)
    .replace('env_http_headers = { "X-Fixture" = "HEADER_CREDENTIAL" }', `http_headers = { "X-Fixture" = "${header}" }`));
  const selected = readSidecarCodexProvider();
  expect(Object.values(selected.env)).toEqual([canary, header]);
  expect(selected.flags.join(" ")).not.toMatch(/disposable|experimental_bearer_token|\.http_headers/);
});

it.each([
  'auth = { command = "never-execute" }',
  'gateway_oauth = { credential_export = { command = "never-execute" } }',
  'wire_api = "chat"',
  'requires_openai_auth = true',
  'env_key = "NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY"',
  'base_url = "https://user:secret@example.invalid"',
  'query_params = { secret = "never-in-argv" }',
])("refuses unsupported auth/transport without echoing values: %s", (line) => {
  write(`model_provider="fixture"\n[model_providers.fixture]\n${line.startsWith("base_url") ? "" : 'base_url="https://example.invalid"\n'}${line}\n`);
  expect(() => readSidecarCodexProvider()).toThrow(/Unsupported Codex Sidecar provider capability/);
  expect(fixture.probe).not.toHaveBeenCalled();
});

it("refuses unreadable syntax, missing profiles and missing provider definitions instead of OpenAI fallback", () => {
  for (const text of ['model_provider = "unterminated', 'profile="absent"', 'model_provider="missing"']) {
    write(text); expect(() => readSidecarCodexProvider()).toThrow(/Unsupported/);
  }
});

it("accepts an inline provider definition and refuses table-valued selections", () => {
  write('model_provider="fixture"\nmodel_providers={fixture={base_url="https://example.invalid"}}');
  expect(readSidecarCodexProvider().provider).toBe("fixture");
  write(config + '\n[[skills.config]]\npath="first"\n[[skills.config]]\npath="second"');
  expect(readSidecarCodexProvider().provider).toBe("fixture");
  for (const text of ['profile=""', 'model_provider={}', '[model_provider]', 'model_provider.id="fixture"', 'profile={}']) {
    write(text);
    expect(() => readSidecarCodexProvider()).toThrow(/Unsupported/);
  }
});

it("refuses static worktree credentials before the CLI probe", async () => {
  write(config.replace('env_key = "PROVIDER_PASSWORD"', 'experimental_bearer_token = "local-static-canary"'));
  const connect = sidecarSessionConnect(root);
  await expect(connect({ id: "s", scope: "worktree", vendor: "codex", worktree: root } as never)).rejects.toThrow(/static credentials/);
  expect(fixture.probe).not.toHaveBeenCalled();
});

it("rejects an opaque effective user model but honors a compatible higher-priority pin", async () => {
  write(config.replace('model = "gpt-6-astra"', 'model = "deployment-prod"'));
  const record = { id: "s", scope: "worktree", vendor: "codex", worktree: root } as const;
  const connect = sidecarSessionConnect(root);
  await expect(connect(record as never)).rejects.toThrow(/model pin/);
  await expect(connect({ ...record, model: "gpt-" + canary } as never)).rejects.toThrow(/model pin/);
  await expect(connect({ ...record, model: "gpt-6-astra" } as never)).resolves.toMatchObject({ model: "gpt-6-astra" });
});

it("treats a pre-provider session record as OpenAI on restore", async () => {
  write('model_provider="openai"');
  const dir = join(root, "sessions"); mkdirSync(dir);
  const connect = sidecarSessionConnect(dir);
  const record = new SidecarSessionRegistry({ dir, connect }).create({ scope: "worktree", worktree: root, vendor: "codex" });
  const indexPath = join(dir, "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  delete index.sessions[0].codexProvider;
  writeFileSync(indexPath, JSON.stringify(index));
  write();
  await expect(new SidecarSessionRegistry({ dir, connect }).sendTurn(record.id, "resume")).rejects.toThrow(/selected provider changed/);
  expect(fixture.spawn).not.toHaveBeenCalled();
});

it("retains the provider across a restart before the first turn", async () => {
  const dir = join(root, "sessions"); mkdirSync(dir);
  const connect = sidecarSessionConnect(dir);
  const record = new SidecarSessionRegistry({ dir, connect }).create({ scope: "worktree", worktree: root, vendor: "codex" });
  rmSync(join(home, "config.toml"));
  await expect(new SidecarSessionRegistry({ dir, connect }).sendTurn(record.id, "first")).rejects.toThrow(/selected provider changed/);
  expect(fixture.spawn).not.toHaveBeenCalled();
});

it("distinguishes missing auth, explicit policy denial and connection failure", () => {
  vi.stubEnv("PROVIDER_PASSWORD", "");
  expect(() => readSidecarCodexProvider()).toThrow(/missing auth/);
  vi.stubEnv("PROVIDER_PASSWORD", canary);
  expect(() => readSidecarCodexProvider(process.env, { deny: ["PROVIDER_PASSWORD"] })).toThrow(/denied/);
  expect(sidecarProviderFailure("401 arbitrary response")).toMatch(/missing auth/);
  expect(sidecarProviderFailure("unexpected argument")).toMatch(/Unsupported/);
  expect(sidecarProviderFailure("connect ECONNREFUSED 127.0.0.1:4010")).toMatch(/connection failure/);
  expect(sidecarProviderFailure("ECONNREFUSED secret")).toMatch(/connection failure/);
  expect(sidecarProviderFailure("ECONNREFUSED secret")).not.toContain("secret");
});

it.each(["401", "HTTP 403", "status code: 401", "authentication failed", "invalid API key"])("gives actionable, sanitized provider auth guidance for %s", (failure) => {
  const message = sidecarProviderFailure(`${failure}: https://provider.invalid/v1 ${canary} ${header}`);
  expect(message).toMatch(/missing auth or rejected credentials/);
  expect(message).toContain("check the selected provider auth configuration and credential source");
  expect(message).toContain("confirm the provider server is available");
  expect(message).toContain("No fallback was attempted.");
  expect(message).not.toMatch(/connection failure|restart|reload|provider\.invalid|disposable/);
});

it.each([undefined, "gpt-6.2-astra"])("retains binary/provider/effective model on fresh, live resume and restored resume (session %s)", async model => {
  fixture.model = "gpt-6-astra";
  const dir = join(root, "sessions"); mkdirSync(dir);
  const connect = sidecarSessionConnect(dir, () => ({ url: "http://127.0.0.1:3333/mcp", headers: { "x-ndx-sidecar-key": "broker-canary" } }));
  let registry = new SidecarSessionRegistry({ dir, connect });
  const record = registry.create({ scope: "worktree", worktree: root, vendor: "codex", model });
  for (let i = 0; i < 3; i++) {
    if (i === 2) registry = new SidecarSessionRegistry({ dir, connect });
    const result = await registry.sendTurn(record.id, "test");
    expect(result.status).toBe("completed");
    const [binary, args, opts] = fixture.spawn.mock.calls[i];
    expect(binary).toBe(fixture.binary);
    expect(args[args.indexOf("-m") + 1]).toBe(model ?? fixture.model);
    expect(args).toContain('model_provider="fixture"');
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("features.apps=false");
    expect(args).toContain("features.shell_snapshot=false");
    expect(args).toContain("shell_environment_policy.set.NDX_SIDECAR_PROVIDER_0=''");
    expect(args).toContain("shell_environment_policy.set.NDX_SIDECAR_PROVIDER_1=''");
    expect(args.includes("resume")).toBe(i > 0);
    expect(opts.env.PROVIDER_PASSWORD).toBeUndefined();
    expect(opts.env.ALTERNATE_PROVIDER_VALUE).toBeUndefined();
    expect(opts.env.HEADER_CREDENTIAL).toBeUndefined();
    expect(opts.env.NDX_SIDECAR_PROVIDER_0).toBe(canary);
    expect(opts.env.NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY).toBe("broker-canary");
    expect(JSON.stringify(args)).not.toMatch(/disposable|broker-canary|never-run/);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(readFileSync(join(dir, `${record.id}.jsonl`), "utf8")).not.toContain(canary);
  }
  expect(fixture.probe).toHaveBeenCalled();
  expect(fixture.probe.mock.calls.every(call => !JSON.stringify(call).includes(canary))).toBe(true);
});

it("propagates the configured OpenAI model when the session has no explicit pin", async () => {
  write('model="gpt-6.2-sol"'); fixture.model = "gpt-6-astra";
  const dir = join(root, "sessions"); mkdirSync(dir);
  const registry = new SidecarSessionRegistry({ dir, connect: sidecarSessionConnect(dir) });
  const record = registry.create({ scope: "worktree", worktree: root, vendor: "codex" });
  await registry.sendTurn(record.id, "test");
  const args = fixture.spawn.mock.calls[0][1];
  expect(args[args.indexOf("-m") + 1]).toBe("gpt-6-astra");
});

it("revalidates configuration and rotated/missing auth on the next live turn", async () => {
  const dir = join(root, "sessions"); mkdirSync(dir);
  const registry = new SidecarSessionRegistry({ dir, connect: sidecarSessionConnect(dir) });
  const record = registry.create({ scope: "worktree", worktree: root, vendor: "codex" });
  await registry.sendTurn(record.id, "first");
  vi.stubEnv("PROVIDER_PASSWORD", "rotated-disposable-canary");
  await registry.sendTurn(record.id, "second");
  expect(fixture.spawn.mock.calls[1][2].env.NDX_SIDECAR_PROVIDER_0).toBe("rotated-disposable-canary");
  vi.stubEnv("PROVIDER_PASSWORD", "");
  await expect(registry.sendTurn(record.id, "third")).rejects.toThrow(/missing auth/);
  expect(fixture.spawn).toHaveBeenCalledTimes(2);
});

it("refuses unsupported selected CLI capability before sending any credential", async () => {
  fixture.version = "codex-cli 0.166.0";
  const dir = join(root, "sessions"); mkdirSync(dir);
  await expect(sidecarSessionConnect(dir)({ id: "s", scope: "worktree", worktree: root, vendor: "codex" } as never)).rejects.toThrow(/Unsupported/);
  expect(fixture.spawn).not.toHaveBeenCalled();
});

it.each([false, true])("never falls back to OpenAI after selected config removal, including restart=%s", async restart => {
  const dir = join(root, "sessions"); mkdirSync(dir);
  const connect = sidecarSessionConnect(dir);
  let registry = new SidecarSessionRegistry({ dir, connect });
  const record = registry.create({ scope: "worktree", worktree: root, vendor: "codex" });
  await registry.sendTurn(record.id, "first");
  rmSync(join(home, "config.toml"));
  if (restart) registry = new SidecarSessionRegistry({ dir, connect });
  await expect(registry.sendTurn(record.id, "second")).rejects.toThrow(/selected provider changed/);
  expect(fixture.spawn).toHaveBeenCalledTimes(1);
});
