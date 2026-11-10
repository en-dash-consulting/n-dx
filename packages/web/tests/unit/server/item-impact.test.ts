/**
 * Impact tags: file kinds, size bands, the security and essential flags, paths
 * mentioned in an item's text, and actual run files winning over them.
 *
 * @see src/server/item-impact.ts
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ESSENTIAL_FAN_IN,
  RunFilesCache,
  computeImpacts,
  fileKind,
  impactSize,
  isSecurityPath,
  mentionedPaths,
  securityTerms,
} from "../../../src/server/item-impact.js";

describe("fileKind", () => {
  it("reads tests first, then docs, config and code", () => {
    expect(fileKind("packages/web/tests/unit/x.test.ts")).toBe("test");
    expect(fileKind("src/a.spec.tsx")).toBe("test");
    expect(fileKind("docs/architecture/overview.md")).toBe("docs");
    expect(fileKind("README.md")).toBe("docs");
    expect(fileKind(".n-dx.json")).toBe("config");
    expect(fileKind(".env.local")).toBe("config");
    expect(fileKind("pnpm-lock.yaml")).toBe("config");
    expect(fileKind("packages/web/src/viewer/a.ts")).toBe("code");
    expect(fileKind("assets/logo.png")).toBe("other");
  });
});

describe("impactSize", () => {
  it("bands 1-3 small, 4-10 medium, more large, none null", () => {
    expect([0, 1, 3, 4, 10, 11].map(impactSize)).toEqual([null, "small", "small", "medium", "medium", "large"]);
  });
});

describe("security", () => {
  it("flags secret-bearing paths but not LLM token code", () => {
    for (const p of [".env", "config/.env.production", "certs/server.pem", "src/auth/session.ts", "lib/credential-store.ts", "keys/id_rsa", "src/api-key.ts", "home/auth.token"]) {
      expect(isSecurityPath(p), p).toBe(true);
    }
    for (const p of ["src/token-usage.ts", "src/author.ts", "docs/keyboard.md", "src/monkey.ts"]) {
      expect(isSecurityPath(p), p).toBe(false);
    }
  });

  it("takes any secret word in a title, but only acting on one in the body", () => {
    expect(securityTerms("Rotate the signing keys")).toEqual(["signing keys"]);
    expect(securityTerms("Housekeeping", "Rotate the API keys and update credentials; key rotation is due"))
      .toEqual(["rotate the api keys", "key rotation"]);
    expect(securityTerms("Impact tags", "flag files with secrets, keys or credentials")).toEqual([]);
    expect(securityTerms("Show token usage per task", "count tokens per run")).toEqual([]);
  });
});

describe("mentionedPaths", () => {
  it("picks file paths and file names out of prose, skipping URLs and non-files", () => {
    const text = "Edit `packages/web/src/viewer/components/ready-to-run.ts` and .n-dx.json, e.g. per https://example.com/a.ts. Bump v1.2 and docs/x.md.";
    expect(mentionedPaths(text).sort()).toEqual([".n-dx.json", "docs/x.md", "packages/web/src/viewer/components/ready-to-run.ts"]);
  });
});

describe("computeImpacts", () => {
  const fanIn = new Map([["packages/core/layout.js", ESSENTIAL_FAN_IN], ["packages/web/src/leaf.ts", 1]]);

  it("uses the paths a change and its tasks name, flagged expected", () => {
    const items = [{
      id: "c1", title: "Change", description: "Touches packages/web/src/leaf.ts",
      children: [{ id: "t1", title: "Task", acceptanceCriteria: ["layout.js reads the new key", "docs/guide.md explains it"] }],
    }];
    const out = computeImpacts(items, new Map(), fanIn);
    expect(out.c1).toMatchObject({ basis: "expected", fileCount: 3, size: "small", kinds: { code: 2, docs: 1 }, essential: ["layout.js"] });
    expect(out.t1).toMatchObject({ basis: "expected", fileCount: 2 });
  });

  it("prefers the files runs changed, over the item and its descendants", () => {
    const items = [{ id: "c1", title: "Rotate secrets", description: "See a.ts", children: [{ id: "t1", title: "t" }] }];
    const ran = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`).concat(["package.json", "config/.env"]);
    const out = computeImpacts(items, new Map([["t1", ran]]), fanIn);
    expect(out.c1).toMatchObject({ basis: "actual", fileCount: 14, size: "large", essential: ["package.json"] });
    expect(out.c1!.security).toEqual(["config/.env", "secrets"]);
    expect(out.c1!.kinds).toEqual({ code: 12, config: 2 });
  });

  it("leaves out an item with nothing to show", () => {
    expect(computeImpacts([{ id: "x", title: "Tidy wording" }], new Map(), fanIn)).toEqual({});
  });
});

describe("RunFilesCache", () => {
  it("groups filesChanged by task and re-reads a file only when it changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "impact-runs-"));
    try {
      const run = (taskId: string, files: string[]) => JSON.stringify({ taskId, structuredSummary: { filesChanged: files } });
      writeFileSync(join(dir, "r1.json"), run("t1", ["a.ts"]));
      writeFileSync(join(dir, "r2.json"), run("t1", ["b.ts"]));
      writeFileSync(join(dir, "r3.json"), "{ not json");
      const cache = new RunFilesCache(dir);
      expect(cache.byTask()).toEqual(new Map([["t1", ["a.ts", "b.ts"]]]));
      writeFileSync(join(dir, "r2.json"), run("t2", ["c.ts"]));
      const later = new Date(Date.now() + 5000);
      utimesSync(join(dir, "r2.json"), later, later);
      expect(cache.byTask()).toEqual(new Map([["t1", ["a.ts"]], ["t2", ["c.ts"]]]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
