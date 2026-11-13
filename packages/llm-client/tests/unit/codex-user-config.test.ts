import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexUserConfigPath, codexUserModelProvider } from "../../src/codex-user-config.js";

let codexHome: string;
const env = (): NodeJS.ProcessEnv => ({ CODEX_HOME: codexHome });
const writeConfig = (text: string): void => writeFileSync(join(codexHome, "config.toml"), text);

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), "codex-user-config-"));
});

afterEach(() => {
  rmSync(codexHome, { recursive: true, force: true });
});

describe("codexUserConfigPath", () => {
  it("reads CODEX_HOME, else ~/.codex", () => {
    expect(codexUserConfigPath(env())).toBe(join(codexHome, "config.toml"));
    expect(codexUserConfigPath({}, "/home/u")).toBe(join("/home/u", ".codex", "config.toml"));
  });
});

describe("codexUserModelProvider", () => {
  it("is undefined when there is no config", () => {
    expect(codexUserModelProvider(env())).toBeUndefined();
  });

  it("is undefined when the config names no provider", () => {
    writeConfig(`model = "gpt-5.5"\n`);
    expect(codexUserModelProvider(env())).toBeUndefined();
  });

  it("reads the top-level model_provider", () => {
    writeConfig(`model_provider = "azure"\n\n[model_providers.azure]\nenv_key = "AZURE_OPENAI_API_KEY"\n`);
    expect(codexUserModelProvider(env())).toBe("azure");
  });

  it("prefers the selected profile's model_provider over the top-level one", () => {
    writeConfig(`model_provider = "openai"\nprofile = "work"\n\n[profiles.work]\nmodel_provider = "azure"\n\n[profiles.home]\nmodel_provider = "ollama"\n`);
    expect(codexUserModelProvider(env())).toBe("azure");
  });

  it("falls back to the top-level model_provider when the selected profile sets none", () => {
    writeConfig(`model_provider = "azure"\nprofile = "work"\n\n[profiles.work]\nmodel = "gpt-5.5"\n`);
    expect(codexUserModelProvider(env())).toBe("azure");
  });

  it("throws when the config exists but cannot be read", () => {
    mkdirSync(join(codexHome, "config.toml"));
    expect(() => codexUserModelProvider(env())).toThrow();
  });
});
