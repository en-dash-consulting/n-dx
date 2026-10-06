/**
 * Tests for credential redaction, environment resolution and `adapters.json`
 * persistence — the part of the removed adapter registry that survived it.
 *
 * The redaction cases carry the weight here. The registry decided what was
 * sensitive from each adapter's `configSchema`, and those schemas went with the
 * adapters, so the key name is now the only signal. The suffix rule has to
 * catch `apiToken` (Jira's schema used to flag it explicitly) without catching
 * `projectKey`, which a naive "contains key" test would redact into an
 * unresolvable marker.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isSensitiveField,
  envVarName,
  redactValue,
  isRedactedField,
  resolveRedactedConfig,
  getAdapterConfig,
  saveAdapterConfig,
  removeAdapterConfig,
  loadAdapterConfigs,
} from "../../../src/store/adapter-config.js";

describe("adapter-config", () => {
  let tmp: string;
  let rexDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "rex-adapter-config-"));
    rexDir = join(tmp, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  // ---- Sensitive field detection -----------------------------------------

  describe("isSensitiveField", () => {
    it.each([
      "token",
      "apiToken",
      "api_token",
      "secret",
      "clientSecret",
      "password",
      "passphrase",
      "apiKey",
      "api_key",
      "credential",
    ])("treats %s as sensitive", (key) => {
      expect(isSensitiveField(key)).toBe(true);
    });

    it.each(["databaseId", "projectId", "projectKey", "domain", "email", "issueType"])(
      "leaves %s alone",
      (key) => {
        expect(isSensitiveField(key)).toBe(false);
      },
    );

    it("honours an explicit sensitive flag for a key the suffix rule misses", () => {
      expect(isSensitiveField("webhookUrl")).toBe(false);
      expect(
        isSensitiveField("webhookUrl", {
          webhookUrl: { required: true, description: "", sensitive: true },
        }),
      ).toBe(true);
    });
  });

  describe("envVarName", () => {
    it("builds REX_<INTEGRATION>_<FIELD> in upper snake case", () => {
      expect(envVarName("notion", "token")).toBe("REX_NOTION_TOKEN");
      expect(envVarName("jira", "apiToken")).toBe("REX_JIRA_API_TOKEN");
      expect(envVarName("github-projects", "token")).toBe("REX_GITHUB_PROJECTS_TOKEN");
    });
  });

  describe("redactValue", () => {
    it("keeps four characters at each end of a long value", () => {
      expect(redactValue("secret_abcdefghijkl")).toBe("secr****ijkl");
    });

    it("masks a short value entirely", () => {
      expect(redactValue("short")).toBe("****");
      expect(redactValue("12345678")).toBe("****");
    });
  });

  describe("isRedactedField", () => {
    it("accepts a well-formed marker", () => {
      expect(isRedactedField({ __redacted: true, envVar: "REX_X_TOKEN", hint: "a****b" })).toBe(true);
    });

    it.each([null, undefined, "token", 42, {}, { __redacted: true }, { envVar: "REX_X_TOKEN" }])(
      "rejects %s",
      (value) => {
        expect(isRedactedField(value)).toBe(false);
      },
    );
  });

  // ---- Environment resolution ---------------------------------------------

  describe("resolveRedactedConfig", () => {
    it("reads redacted fields from the environment and passes the rest through", () => {
      process.env.REX_NOTION_TOKEN = "secret_live_value";
      try {
        const resolved = resolveRedactedConfig("notion", {
          token: { __redacted: true, envVar: "REX_NOTION_TOKEN", hint: "secr****alue" },
          databaseId: "db-123",
        });
        expect(resolved).toEqual({ token: "secret_live_value", databaseId: "db-123" });
      } finally {
        delete process.env.REX_NOTION_TOKEN;
      }
    });

    it("names the missing variable when it is not set", () => {
      delete process.env.REX_NOTION_TOKEN;
      expect(() =>
        resolveRedactedConfig("notion", {
          token: { __redacted: true, envVar: "REX_NOTION_TOKEN", hint: "secr****alue" },
        }),
      ).toThrow(/REX_NOTION_TOKEN/);
    });
  });

  // ---- adapters.json persistence ------------------------------------------

  describe("persistence", () => {
    it("returns an empty list when adapters.json does not exist", async () => {
      expect(await loadAdapterConfigs(rexDir)).toEqual([]);
      expect(await getAdapterConfig(rexDir, "notion")).toBeNull();
    });

    it("round-trips a non-sensitive config", async () => {
      await saveAdapterConfig(rexDir, { name: "notion", config: { databaseId: "db-123" } });
      expect(await getAdapterConfig(rexDir, "notion")).toEqual({
        name: "notion",
        config: { databaseId: "db-123" },
      });
    });

    it("never writes a secret to disk in plaintext", async () => {
      await saveAdapterConfig(rexDir, {
        name: "jira",
        config: { apiToken: "live_token_value_1234", projectKey: "PRD" },
      });

      const raw = await readFile(join(rexDir, "adapters.json"), "utf-8");
      expect(raw).not.toContain("live_token_value_1234");

      const saved = await getAdapterConfig(rexDir, "jira");
      expect(saved!.config.projectKey).toBe("PRD");
      expect(isRedactedField(saved!.config.apiToken)).toBe(true);
      expect((saved!.config.apiToken as { envVar: string }).envVar).toBe("REX_JIRA_API_TOKEN");
    });

    it("keeps several integrations side by side and replaces by name", async () => {
      await saveAdapterConfig(rexDir, { name: "notion", config: { databaseId: "one" } });
      await saveAdapterConfig(rexDir, { name: "jira", config: { projectKey: "PRD" } });
      await saveAdapterConfig(rexDir, { name: "notion", config: { databaseId: "two" } });

      const configs = await loadAdapterConfigs(rexDir);
      expect(configs).toHaveLength(2);
      expect((await getAdapterConfig(rexDir, "notion"))!.config.databaseId).toBe("two");
    });

    it("removes one entry and leaves the others", async () => {
      await saveAdapterConfig(rexDir, { name: "notion", config: { databaseId: "one" } });
      await saveAdapterConfig(rexDir, { name: "jira", config: { projectKey: "PRD" } });

      await removeAdapterConfig(rexDir, "notion");

      expect(await getAdapterConfig(rexDir, "notion")).toBeNull();
      expect(await getAdapterConfig(rexDir, "jira")).not.toBeNull();
    });

    it("saves a secret that the caller's schema flags but the key name does not", async () => {
      await saveAdapterConfig(
        rexDir,
        { name: "custom", config: { webhookUrl: "https://hooks.example/abcdefghijkl" } },
        { webhookUrl: { required: true, description: "", sensitive: true } },
      );

      const saved = await getAdapterConfig(rexDir, "custom");
      expect(isRedactedField(saved!.config.webhookUrl)).toBe(true);
    });
  });
});
