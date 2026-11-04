/**
 * `llm.<vendor>.auth` (cli | api | auto) and the vendor key resolver.
 *
 * The rule under test: a key held only in the credential store never selects
 * the API under `auto`, and with no store entry every mode choice and child
 * env is what it was before the store could hold vendor keys. Every value here
 * is a placeholder in a temp ndx home.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CREDENTIAL_ENV_VARS,
  clearCredentialHelperCache,
  setCredential,
  setHelperCredential,
} from "../../src/credential-store.js";
import {
  describeVendorAuth,
  missingVendorKeyError,
  requireVendorApiKey,
  resolveVendorAuth,
  resolveVendorKey,
} from "../../src/vendor-auth.js";
import { detectAuthMode } from "../../src/create-client.js";
import { createLLMClient, detectLLMAuthMode } from "../../src/llm-client.js";
import { resolveVendorCliEnv } from "../../src/child-env.js";
import { parseLLMConfig } from "../../src/llm-config.js";
import { diagnoseAuth } from "../../src/auth.js";
import { runCredentialsCli } from "../../src/cli/credentials.js";
import type { LLMConfig } from "../../src/llm-types.js";

const STORED = "placeholder-stored-vendor-key";
const EXPORTED = "placeholder-exported-vendor-key";
const CONFIGURED = "placeholder-configured-vendor-key";
const JEV = "placeholder-stored-jev-key";
const HELPER = "placeholder-helper-entry-value";

const KEY_ENV = { claude: "ANTHROPIC_API_KEY", codex: "OPENAI_API_KEY", google: "GEMINI_API_KEY" } as const;
const CLI_VENDORS = ["claude", "codex"] as const;

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-vendor-auth-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const store = (vendor: string, value = STORED) => setCredential(vendor, value, { ndxHome: home });
const withAuth = (vendor: "claude" | "codex" | "google", auth: string, extra: Record<string, string> = {}): LLMConfig =>
  ({ vendor, [vendor]: { auth, ...extra } }) as LLMConfig;

/** Point process.env at the temp home, with no vendor key exported. */
function isolateProcessEnv(): void {
  vi.stubEnv("NDX_HOME", home);
  for (const name of Object.values(KEY_ENV)) vi.stubEnv(name, undefined);
}

describe("resolveVendorKey", () => {
  it("maps each vendor entry to its variable", () => {
    expect(CREDENTIAL_ENV_VARS).toEqual({
      typesafe: "TYPESAFE_API_KEY",
      claude: "ANTHROPIC_API_KEY",
      codex: "OPENAI_API_KEY",
      google: "GEMINI_API_KEY",
    });
  });

  it.each(["claude", "codex", "google"] as const)("reads %s from config, then env, then the store", (vendor) => {
    store(vendor);
    const env = { [KEY_ENV[vendor]]: EXPORTED };
    expect(resolveVendorKey(vendor, { [vendor]: { api_key: CONFIGURED } }, { env, ndxHome: home }))
      .toEqual({ value: CONFIGURED, source: "config" });
    expect(resolveVendorKey(vendor, {}, { env, ndxHome: home })).toEqual({ value: EXPORTED, source: "env" });
    expect(resolveVendorKey(vendor, {}, { env: {}, ndxHome: home })).toEqual({ value: STORED, source: "file" });
  });

  it("reads google's variable from llm.google.apiKeyEnv", () => {
    const config: LLMConfig = { google: { apiKeyEnv: "MY_GEMINI_KEY" } };
    expect(resolveVendorKey("google", config, { env: { MY_GEMINI_KEY: EXPORTED, GEMINI_API_KEY: "other" }, ndxHome: home }))
      .toEqual({ value: EXPORTED, source: "env" });
  });
});

describe("auth auto", () => {
  it.each(CLI_VENDORS)("%s: a key held only in the store selects the CLI", (vendor) => {
    store(vendor);
    const decision = resolveVendorAuth(vendor, { vendor }, { env: {}, ndxHome: home });
    expect(decision).toMatchObject({ auth: "auto", authSource: "built-in", mode: "cli", storedKeyHeld: true });
    expect(decision.key).toBeUndefined();
  });

  it.each(CLI_VENDORS)("%s: an exported or configured key selects the API", (vendor) => {
    store(vendor);
    expect(resolveVendorAuth(vendor, {}, { env: { [KEY_ENV[vendor]]: EXPORTED }, ndxHome: home }))
      .toMatchObject({ mode: "api", key: { source: "env" } });
    expect(resolveVendorAuth(vendor, { [vendor]: { api_key: CONFIGURED } }, { env: {}, ndxHome: home }))
      .toMatchObject({ mode: "api", key: { source: "config" } });
  });

  it("google (no CLI login) uses a stored key", () => {
    store("google");
    expect(resolveVendorAuth("google", {}, { env: {}, ndxHome: home }))
      .toMatchObject({ mode: "api", key: { value: STORED, source: "file" } });
  });

  it("detectAuthMode and detectLLMAuthMode pick the CLI for a store-only key", () => {
    isolateProcessEnv();
    store("claude");
    store("codex");
    expect(detectAuthMode({ claudeConfig: {} })).toBe("cli");
    expect(detectLLMAuthMode({ vendor: "claude", llmConfig: {} })).toBe("cli");
    expect(detectLLMAuthMode({ vendor: "codex", llmConfig: {} })).toBe("cli");
    vi.stubEnv("ANTHROPIC_API_KEY", EXPORTED);
    expect(detectAuthMode({ claudeConfig: {} })).toBe("api");
  });
});

describe("auth cli", () => {
  it.each(CLI_VENDORS)("%s: the CLI even when every source holds a key", (vendor) => {
    store(vendor);
    const decision = resolveVendorAuth(vendor, withAuth(vendor, "cli", { api_key: CONFIGURED }), {
      env: { [KEY_ENV[vendor]]: EXPORTED }, ndxHome: home,
    });
    expect(decision).toMatchObject({ auth: "cli", authSource: `llm.${vendor}.auth`, mode: "cli" });
    expect(decision.key).toBeUndefined();
  });

  it("createLLMClient uses the CLI provider though a key resolves", () => {
    isolateProcessEnv();
    vi.stubEnv("ANTHROPIC_API_KEY", EXPORTED);
    expect(createLLMClient({ vendor: "claude", llmConfig: withAuth("claude", "cli", { api_key: CONFIGURED }) }).mode)
      .toBe("cli");
    expect(createLLMClient({ vendor: "claude", llmConfig: {} }).mode).toBe("api");
  });

  it("an API provider refuses, naming both settings", () => {
    expect(() => requireVendorApiKey("claude", withAuth("claude", "cli"), { env: { ANTHROPIC_API_KEY: EXPORTED }, ndxHome: home }))
      .toThrow(/llm\.claude\.auth is "cli"/);
  });

  it("google refuses cli at load and runs on auto", () => {
    expect(parseLLMConfig({ llm: { google: { auth: "cli" } } }).google).toBeUndefined();
    expect(parseLLMConfig({ llm: { claude: { auth: "api" }, codex: { auth: "cli" }, google: { auth: "api" } } }))
      .toMatchObject({ claude: { auth: "api" }, codex: { auth: "cli" }, google: { auth: "api" } });
    expect(parseLLMConfig({ llm: { claude: { auth: "sometimes" } } }).claude).toBeUndefined();
  });
});

describe("auth api", () => {
  it.each(["claude", "codex", "google"] as const)("%s: a stored key is used", (vendor) => {
    store(vendor);
    expect(requireVendorApiKey(vendor, withAuth(vendor, "api"), { env: {}, ndxHome: home }))
      .toEqual({ value: STORED, source: "file" });
  });

  it.each(["claude", "codex"] as const)("%s: no key is a loud error naming the store and the setting", (vendor) => {
    const run = () => requireVendorApiKey(vendor, withAuth(vendor, "api"), { env: {}, ndxHome: home });
    expect(run).toThrow(`ndx config credentials.${vendor}`);
    expect(run).toThrow(`llm.${vendor}.auth`);
  });

  it("auto with only a stored key gets the same error as api with no key", () => {
    store("claude");
    const auto = () => requireVendorApiKey("claude", { claude: {} }, { env: {}, ndxHome: home });
    expect(auto).toThrow(missingVendorKeyError("claude", {}).message);
  });
});

describe("a helper-backed vendor key", () => {
  /** A helperExec counting its runs; it prints the placeholder. */
  function countingExec() {
    let runs = 0;
    const helperExec = (() => {
      runs += 1;
      return HELPER;
    }) as never;
    return { helperExec, runs: () => runs };
  }

  beforeEach(() => {
    setHelperCredential("claude", ["op", "read", `op://v/claude/${Math.random()}`], { ndxHome: home });
  });
  afterEach(() => clearCredentialHelperCache());

  it("auto and cli never run the helper, and count the key as held", () => {
    const { helperExec, runs } = countingExec();
    expect(resolveVendorAuth("claude", {}, { env: {}, ndxHome: home, helperExec }))
      .toMatchObject({ mode: "cli", storedKeyHeld: true });
    expect(resolveVendorAuth("claude", withAuth("claude", "cli"), { env: {}, ndxHome: home, helperExec }))
      .toMatchObject({ mode: "cli", storedKeyHeld: true });
    expect(runs()).toBe(0);
  });

  it("api runs it and uses its output", () => {
    const { helperExec, runs } = countingExec();
    expect(requireVendorApiKey("claude", withAuth("claude", "api"), { env: {}, ndxHome: home, helperExec }))
      .toEqual({ value: HELPER, source: "helper" });
    expect(runs()).toBe(1);
  });

  it("status without running helpers says the helper was not run", () => {
    const { helperExec, runs } = countingExec();
    const decision = resolveVendorAuth("claude", withAuth("claude", "api"), { env: {}, ndxHome: home, helperExec, runHelpers: false });
    expect(describeVendorAuth(decision, "ANTHROPIC_API_KEY", false)).toBe(
      "claude: api (llm.claude.auth api; key from the credential store's helper, not run (--check runs it))",
    );
    expect(runs()).toBe(0);
  });
});

describe("resolveVendorCliEnv", () => {
  const source = (extra: Record<string, string> = {}) => ({
    PATH: "/bin", HOME: "/home/user", NDX_HOME: home,
    ANTHROPIC_API_KEY: EXPORTED, anthropic_api_key: "placeholder-lowercase",
    OPENAI_API_KEY: "placeholder-openai", GEMINI_API_KEY: "placeholder-gemini",
    TYPESAFE_API_KEY: "placeholder-jev-exported",
    ...extra,
  });

  it("cli: removes the vendor key in every casing and injects no configured or stored key", () => {
    store("claude");
    const env = resolveVendorCliEnv(withAuth("claude", "cli", { api_key: CONFIGURED }), undefined, source());
    expect(Object.keys(env).filter((k) => k.toUpperCase() === "ANTHROPIC_API_KEY")).toEqual([]);
    expect(Object.values(env)).not.toContain(CONFIGURED);
    expect(Object.values(env)).not.toContain(STORED);
  });

  it("cli: Bedrock and Vertex credentials are untouched", () => {
    const bedrock = { CLAUDE_CODE_USE_BEDROCK: "1", AWS_ACCESS_KEY_ID: "placeholder-access", AWS_SECRET_ACCESS_KEY: "placeholder-secret" };
    const env = resolveVendorCliEnv(withAuth("claude", "cli"), undefined, source(bedrock));
    expect(env).toMatchObject(bedrock);
    const vertex = { CLAUDE_CODE_USE_VERTEX: "1", GOOGLE_APPLICATION_CREDENTIALS: "/fixture/google.json" };
    expect(resolveVendorCliEnv(withAuth("claude", "cli"), undefined, source(vertex))).toMatchObject(vertex);
  });

  it.each(CLI_VENDORS)("api: the %s CLI child gets the stored key under its own name only", (vendor) => {
    store(vendor);
    store(vendor === "claude" ? "codex" : "claude", "placeholder-other-vendor");
    const base = source();
    delete (base as Record<string, string>)[KEY_ENV[vendor]];
    delete (base as Record<string, string>).anthropic_api_key;
    const env = resolveVendorCliEnv(withAuth(vendor, "api"), undefined, base);
    expect(env[KEY_ENV[vendor]]).toBe(STORED);
    expect(Object.entries(env).filter(([, v]) => v === STORED).map(([k]) => k)).toEqual([KEY_ENV[vendor]]);
    expect(Object.values(env)).not.toContain("placeholder-other-vendor");
  });

  describe("the agent's own commands never see a key n-dx hands the Claude CLI", () => {
    const SCRUB = "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB";
    const bare = (extra: Record<string, string> = {}) => ({ PATH: "/bin", NDX_HOME: home, ...extra });
    afterEach(() => clearCredentialHelperCache());

    it("api with a stored key: the CLI gets the key and scrubs it from its subprocesses", () => {
      store("claude");
      const env = resolveVendorCliEnv(withAuth("claude", "api"), undefined, bare());
      expect(env.ANTHROPIC_API_KEY).toBe(STORED);
      expect(env[SCRUB]).toBe("1");
    });

    it("api with a helper key: the same", () => {
      // resolveVendorCliEnv takes no helperExec, so the helper really runs:
      // node and a script, since helpers run without a shell (no `echo` on Windows).
      const script = join(home, "print-key.mjs");
      writeFileSync(script, `process.stdout.write(${JSON.stringify(HELPER)});\n`);
      setHelperCredential("claude", [process.execPath, script], { ndxHome: home });
      const env = resolveVendorCliEnv(withAuth("claude", "api"), undefined, bare());
      expect(env.ANTHROPIC_API_KEY).toBe(HELPER);
      expect(env[SCRUB]).toBe("1");
    });

    it("a scrub the environment turned off, in any casing, is turned back on", () => {
      store("claude");
      const env = resolveVendorCliEnv(withAuth("claude", "api"), undefined, bare({ [SCRUB]: "0", claude_code_subprocess_env_scrub: "0" }));
      expect(Object.entries(env).filter(([k]) => k.toUpperCase() === SCRUB)).toEqual([[SCRUB, "1"]]);
    });

    it("a configured key under auto is scrubbed too", () => {
      expect(resolveVendorCliEnv({ vendor: "claude", claude: { api_key: CONFIGURED } }, undefined, bare())[SCRUB]).toBe("1");
    });

    it("cli and a codex child are left alone", () => {
      store("claude");
      store("codex");
      expect(resolveVendorCliEnv(withAuth("claude", "cli"), undefined, bare())[SCRUB]).toBeUndefined();
      expect(resolveVendorCliEnv(withAuth("codex", "api"), undefined, bare())[SCRUB]).toBeUndefined();
    });
  });

  it("api: no key from any source is a loud error naming the store and the setting", () => {
    const run = () => resolveVendorCliEnv(withAuth("codex", "api"), undefined, { PATH: "/bin", NDX_HOME: home });
    expect(run).toThrow("ndx config credentials.codex");
    expect(run).toThrow("llm.codex.auth");
  });

  it("with no store entry, auto is byte-identical to the pre-store rules", () => {
    // Reference: main's rules. A configured key replaces every casing of the
    // name; otherwise the exported key passes through as is.
    for (const vendor of ["claude", "codex", "google"] as const) {
      for (const config of [{ vendor }, { vendor, [vendor]: { api_key: CONFIGURED } }] as LLMConfig[]) {
        const empty = resolveVendorCliEnv(config, undefined, source());
        store("typesafe", JEV);
        const withOtherEntries = resolveVendorCliEnv(config, undefined, source());
        expect(JSON.stringify(withOtherEntries)).toBe(JSON.stringify(empty));
        const keyEnv = KEY_ENV[vendor];
        const configured = config[vendor]?.api_key;
        expect(empty[keyEnv]).toBe(configured ?? source()[keyEnv]);
      }
    }
  });

  it("auto: a stored vendor key changes nothing", () => {
    for (const vendor of ["claude", "codex", "google"] as const) {
      const before = resolveVendorCliEnv({ vendor }, undefined, source());
      store(vendor);
      expect(JSON.stringify(resolveVendorCliEnv({ vendor }, undefined, source()))).toBe(JSON.stringify(before));
      const bare = { PATH: "/bin", NDX_HOME: home };
      expect(Object.values(resolveVendorCliEnv({ vendor }, undefined, bare))).not.toContain(STORED);
    }
  });

  it("typesafe and helper values never reach any child env, in any mode", () => {
    setCredential("typesafe", JEV, { ndxHome: home });
    store("claude");
    store("codex");
    store("google");
    // A helper-backed entry (C4) holds a command, not a key; it is never read as one.
    const path = join(home, "credentials.json");
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    raw.entries["connection:helper"] = { backend: "helper", value: HELPER, updatedAt: "2026-11-02T00:00:00Z" };
    writeFileSync(path, JSON.stringify(raw), { mode: 0o600 });
    for (const vendor of ["claude", "codex", "google"] as const) {
      for (const auth of vendor === "google" ? ["api", "auto"] : ["cli", "api", "auto"]) {
        const env = resolveVendorCliEnv(withAuth(vendor, auth), undefined, source());
        expect(env.TYPESAFE_API_KEY, `${vendor} ${auth}`).toBeUndefined();
        expect(Object.values(env), `${vendor} ${auth}`).not.toContain(JEV);
        expect(Object.values(env), `${vendor} ${auth}`).not.toContain(HELPER);
      }
    }
  });
});

describe("status", () => {
  it("describes mode and key source, never the value", () => {
    store("claude");
    const line = describeVendorAuth(resolveVendorAuth("claude", {}, { env: {}, ndxHome: home }), "ANTHROPIC_API_KEY");
    expect(line).toBe("claude: cli (store key held, unused)");
    const api = describeVendorAuth(resolveVendorAuth("claude", withAuth("claude", "api"), { env: {}, ndxHome: home }), "ANTHROPIC_API_KEY");
    expect(api).toBe("claude: api (llm.claude.auth api; key from the credential store)");
  });

  it("diagnoseAuth returns mode and keySource", async () => {
    isolateProcessEnv();
    store("claude");
    const diagnosis = await diagnoseAuth({ claudeConfig: { cli_path: join(home, "no-such-claude") } });
    expect(diagnosis).toMatchObject({ mode: "auto", keySource: "file", recommendedMode: "none" });
    const api = await diagnoseAuth({ claudeConfig: { auth: "api", cli_path: join(home, "no-such-claude") } });
    expect(api).toMatchObject({ mode: "api", keySource: "file", recommendedMode: "api" });
    expect(JSON.stringify([diagnosis, api])).not.toContain(STORED);
  });

  it("credentials status --project prints each vendor's mode and never a value", async () => {
    store("claude");
    const project = mkdtempSync(join(tmpdir(), "ndx-vendor-auth-project-"));
    try {
      writeFileSync(join(project, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude", codex: { auth: "cli" } } }));
      let out = "";
      const code = await runCredentialsCli(["status", `--project=${project}`], {
        readStdin: async () => null,
        stdout: (t) => { out += t; },
        stderr: () => {},
        store: { ndxHome: home, env: {} },
      });
      expect(code).toBe(0);
      expect(out).toContain("claude: cli (store key held, unused)");
      expect(out).toContain("codex: cli (llm.codex.auth cli)");
      expect(out).toContain("google: api (no key: store one with ndx config credentials.google)");
      expect(out).not.toContain(STORED);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
