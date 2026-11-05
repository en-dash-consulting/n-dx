import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConnections } from "../../../../src/server/connections/connection-config.js";
import { removeTempDir } from "../../../helpers/temp-dir.js";

const dirs: string[] = [];

function project(files: { local?: unknown; shared?: unknown }): string {
  const dir = mkdtempSync(join(tmpdir(), "ndx-connections-config-"));
  dirs.push(dir);
  if (files.local !== undefined) writeFileSync(join(dir, ".n-dx.local.json"), JSON.stringify(files.local));
  if (files.shared !== undefined) writeFileSync(join(dir, ".n-dx.json"), JSON.stringify(files.shared));
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeTempDir));
});

describe("loadConnections", () => {
  it("reads http and stdio connections from .n-dx.local.json", () => {
    const dir = project({
      local: {
        connections: {
          docs: { transport: "http", url: "https://example.test/mcp", auth: "token", label: "Docs" },
          local: { transport: "stdio", command: "node", args: ["server.mjs"], env: { MODE: "test" } },
        },
      },
    });
    expect(loadConnections(dir, { warn: () => undefined })).toEqual([
      { id: "docs", label: "Docs", auth: "token", transport: "http", url: "https://example.test/mcp" },
      { id: "local", label: "local", auth: "none", transport: "stdio", command: "node", args: ["server.mjs"], env: { MODE: "test" } },
    ]);
  });

  it("reads field hints, and skips a malformed hint with a warning that names it", () => {
    const dir = project({
      local: {
        connections: {
          docs: {
            transport: "http",
            url: "https://example.test/mcp",
            fieldHints: {
              ownerId: { optionsFrom: { tool: "list_owners", path: "owners" } },
              teamId: { auto: true },
              rootList: { optionsFrom: { tool: "list_all" } },
              bad: { optionsFrom: { path: "x" } },
              worse: "yes",
            },
          },
        },
      },
    });
    const warnings: string[] = [];
    const [connection] = loadConnections(dir, { warn: (m) => warnings.push(m) });
    expect(connection.fieldHints).toEqual({
      ownerId: { optionsFrom: { tool: "list_owners", path: "owners" } },
      teamId: { auto: true },
      rootList: { optionsFrom: { tool: "list_all", path: "" } },
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"bad"');
    expect(warnings[1]).toContain('"worse"');
  });

  it("reads the profile a connection names, and skips a malformed one with a warning", () => {
    const dir = project({
      local: {
        connections: {
          caos: { transport: "http", url: "https://example.test/mcp", profile: " caos " },
          odd: { transport: "http", url: "https://example.test/mcp", profile: 7 },
        },
      },
    });
    const warnings: string[] = [];
    const [caos, odd] = loadConnections(dir, { warn: (m) => warnings.push(m) });
    expect(caos.profile).toBe("caos");
    expect(odd).not.toHaveProperty("profile");
    expect(warnings).toEqual([expect.stringContaining('Connection "odd": profile must be')]);
  });

  it("leaves fieldHints unset when the connection has none", () => {
    const dir = project({ local: { connections: { docs: { transport: "http", url: "https://example.test/mcp" } } } });
    expect(loadConnections(dir, { warn: () => undefined })[0]).not.toHaveProperty("fieldHints");
  });

  it("ignores a tracked .n-dx.json connections block and warns once", () => {
    const dir = project({
      shared: { connections: { evil: { transport: "stdio", command: "sh", args: ["-c", "id"] } } },
    });
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    expect(loadConnections(dir, { warn })).toEqual([]);
    expect(loadConnections(dir, { warn })).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(".n-dx.json");
    expect(warnings[0]).toContain(".n-dx.local.json");
  });

  it("ignores a .n-dx.local.json the repository commits, and warns once", () => {
    const dir = project({
      local: { connections: { evil: { transport: "stdio", command: "sh", args: ["-c", "id"] } } },
    });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    git("add", "-f", ".n-dx.local.json");
    git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "commit local config");
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    expect(loadConnections(dir, { warn })).toEqual([]);
    expect(loadConnections(dir, { warn })).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("commits that file");
  });

  it("skips invalid entries, naming each", () => {
    const dir = project({
      local: {
        connections: {
          "Bad_Id": { transport: "http", url: "https://example.test" },
          piped: { transport: "stdio", command: "node", auth: "token" },
          creds: { transport: "http", url: "https://user:pw@example.test" },
          ftp: { transport: "http", url: "ftp://example.test" },
          ok: { transport: "http", url: "http://127.0.0.1:1/mcp" },
        },
      },
    });
    const warnings: string[] = [];
    expect(loadConnections(dir, { warn: (m) => warnings.push(m) }).map((c) => c.id)).toEqual(["ok"]);
    expect(warnings.join("\n")).toMatch(/Bad_Id[\s\S]*piped[\s\S]*creds[\s\S]*ftp/);
    expect(warnings.join("\n")).not.toContain("pw@");
  });

  it("reads no connections when none are declared", () => {
    expect(loadConnections(project({ local: { web: {} } }), { warn: () => undefined })).toEqual([]);
  });

  it("reads an OAuth connection's client override: another metadata document or a pre-registered client", () => {
    const url = "https://caos.example/mcp";
    const dir = project({
      local: {
        connections: {
          doc: { transport: "http", url, auth: "oauth", oauth: { clientMetadataUrl: "https://example.test/n-dx/client.json" } },
          pre: { transport: "http", url, auth: "oauth", oauth: { clientId: "n-dx-desktop" } },
        },
      },
    });
    expect(loadConnections(dir, { warn: () => undefined }).map((c) => (c.transport === "http" ? c.oauth : undefined))).toEqual([
      { clientMetadataUrl: "https://example.test/n-dx/client.json" },
      { clientId: "n-dx-desktop" },
    ]);
  });

  it("skips a connection whose OAuth client override is not valid, naming why", () => {
    const url = "https://caos.example/mcp";
    const oauth = (block: unknown, auth = "oauth") => ({ transport: "http", url, auth, oauth: block });
    const dir = project({
      local: {
        connections: {
          "plain-http": oauth({ clientMetadataUrl: "http://example.test/client.json" }),
          "root-path": oauth({ clientMetadataUrl: "https://example.test/" }),
          "fragment": oauth({ clientMetadataUrl: "https://example.test/client.json#x" }),
          "both": oauth({ clientMetadataUrl: "https://example.test/client.json", clientId: "x" }),
          "spaced": oauth({ clientId: "has space" }),
          "unknown-key": oauth({ clientSecret: "s" }),
          "token-auth": oauth({ clientId: "x" }, "token"),
          "stdio": { transport: "stdio", command: "node", oauth: { clientId: "x" } },
          "ok": oauth({ clientId: "fine" }),
        },
      },
    });
    const warnings: string[] = [];
    expect(loadConnections(dir, { warn: (m) => warnings.push(m) }).map((c) => c.id)).toEqual(["ok"]);
    const text = warnings.join("\n");
    expect(text).toContain(`"plain-http": oauth.clientMetadataUrl must be an HTTPS URL with a path`);
    expect(text).toContain(`"root-path": oauth.clientMetadataUrl must be an HTTPS URL with a path`);
    expect(text).toContain(`"fragment": oauth.clientMetadataUrl`);
    expect(text).toContain(`"both": oauth takes clientMetadataUrl or clientId, not both`);
    expect(text).toContain(`"spaced": oauth.clientId must be a client id`);
    expect(text).toContain(`"unknown-key": oauth takes clientMetadataUrl or clientId, not clientSecret`);
    expect(text).toContain(`"token-auth": oauth is for an auth "oauth" connection only`);
    expect(text).toContain(`"stdio": oauth is for an auth "oauth" connection only`);
  });
});
