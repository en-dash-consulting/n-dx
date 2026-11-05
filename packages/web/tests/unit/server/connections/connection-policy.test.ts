/**
 * Static rules for the connections gateway (Sidecar design §14): it stays
 * generic, and one module alone touches the per-user credential store.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = resolve(import.meta.dirname, "../../../..");
const SRC = join(WEB_ROOT, "src");
const CONNECTIONS = join(SRC, "server", "connections");
const CREDENTIALS_MODULE = "src/server/connections/connection-credentials.ts";

/** The credential-store functions @n-dx/llm-client exports. */
const STORE_FUNCTIONS = [
  "resolveCredential",
  "storedCredential",
  "hasStoredCredential",
  "setCredential",
  "setHelperCredential",
  "unsetCredential",
  "credentialStatus",
  "credentialFingerprint",
  "credentialStorePath",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Names a file imports from @n-dx/llm-client. */
function llmClientImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@n-dx\/llm-client["']/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}

describe("connections policy", () => {
  it("only connection-credentials.ts imports the credential-store functions in packages/web/src", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const rel = relative(WEB_ROOT, file).split("\\").join("/");
      if (rel === CREDENTIALS_MODULE) return [];
      const source = readFileSync(file, "utf-8");
      const names = llmClientImports(source).filter((name) => STORE_FUNCTIONS.includes(name));
      const namespaced = /import\s+\*\s+as\s+\w+\s+from\s*["']@n-dx\/llm-client["']/.test(source) ? ["* as"] : [];
      return [...names, ...namespaced].map((name) => `${rel}: ${name}`);
    });
    expect(offenders).toEqual([]);
    expect(llmClientImports(readFileSync(join(WEB_ROOT, CREDENTIALS_MODULE), "utf-8"))).toContain("storedCredential");
  });

  it("names no tracker, tracker tool or tracker status in src/server/connections/", () => {
    const hits = sourceFiles(CONNECTIONS).flatMap((file) =>
      readFileSync(file, "utf-8")
        .split("\n")
        .flatMap((line, index) => (/caos|work_item/i.test(line) ? [`${relative(WEB_ROOT, file)}:${index + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
