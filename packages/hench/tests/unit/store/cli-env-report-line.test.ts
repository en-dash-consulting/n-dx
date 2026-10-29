import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cliEnvReportLine, resolveVendorCliEnv } from "../../../src/store/project-config.js";

describe("cliEnvReportLine", () => {
  let codexHome: string | undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (codexHome) rmSync(codexHome, { recursive: true, force: true });
    codexHome = undefined;
  });

  it("a Codex env_key mode without its variable is reported by name, with no fallback claim", () => {
    codexHome = mkdtempSync(join(tmpdir(), "hench-codex-home-"));
    writeFileSync(join(codexHome, "config.toml"), [
      'model_provider = "azure"',
      "[model_providers.azure]",
      'env_key = "AZURE_OPENAI_API_KEY"',
      "",
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("AZURE_OPENAI_API_KEY", undefined);

    const lines: string[] = [];
    resolveVendorCliEnv({ vendor: "codex" }, undefined, (names, kind) => {
      lines.push(cliEnvReportLine("CLI environment", names, kind));
    });

    const missing = lines.filter((line) => line.includes("a vendor mode is on"));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("AZURE_OPENAI_API_KEY");
    expect(missing[0]).not.toMatch(/falls back|credential files|instance metadata/);
  });

  it("names stripped variables under the given label", () => {
    expect(cliEnvReportLine("codex reviewer environment", ["GITHUB_TOKEN"], "stripped"))
      .toBe("codex reviewer environment: stripped GITHUB_TOKEN");
  });
});
