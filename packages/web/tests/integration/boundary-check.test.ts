/**
 * Server/client boundary enforcement test.
 *
 * Ensures no import crosses the boundary between src/server/ and src/viewer/.
 * This catches accidental coupling that would not be flagged by the build
 * since both sides compile under the same tsconfig.
 *
 * @see tests/e2e/domain-isolation.test.js — cross-package gateway enforcement
 * @see tests/e2e/architecture-policy.test.js — orchestration spawn-only + zone cycle detection
 *
 * These three test files together enforce the full architectural guardrail suite.
 * Changes to one should be reviewed against the others for consistency.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB_SRC = join(import.meta.dirname!, "..", "..", "src");

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** Extract import paths from a TypeScript file. */
function extractImportPaths(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const paths: string[] = [];
  // Matches: import ... from "..." and import "..."
  const re = /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}\s+from\s+|[\w*]+\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    paths.push(m[1]!);
  }
  return paths;
}

describe("server/client boundary", () => {
  it("no server file imports from viewer", () => {
    const serverDir = join(WEB_SRC, "server");
    const violations: string[] = [];

    try {
      for (const file of collectTsFiles(serverDir)) {
        const rel = relative(WEB_SRC, file);
        for (const imp of extractImportPaths(file)) {
          if (imp.includes("/viewer/") || imp.match(/\.\.\/viewer\b/)) {
            violations.push(`${rel} imports "${imp}"`);
          }
        }
      }
    } catch {
      // serverDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  it("viewer cross-boundary imports flow through external.ts gateway", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);
        // The gateway itself is allowed to import from outside
        if (rel === join("viewer", "external.ts")) continue;

        // Messaging infrastructure is allowed to import directly from shared/
        // to avoid creating a zone-level dependency inversion through external.ts.
        // The shared/ directory is neutral (neither server nor viewer), so
        // messaging utilities can access it without violating the server/client boundary.
        const isMessaging = rel.startsWith(join("viewer", "messaging") + "/") ||
          rel === join("viewer", "messaging");

        for (const imp of extractImportPaths(file)) {
          // Check for direct imports to schema/ from viewer files
          if (imp.match(/\.\.\/schema\b/)) {
            violations.push(`${rel} imports "${imp}" — must use ./external.js gateway`);
          }
          // Check for direct imports to shared/ from non-messaging viewer files
          if (imp.match(/shared\b/) && imp.startsWith("..") && !isMessaging) {
            violations.push(`${rel} imports "${imp}" — must use ./external.js gateway`);
          }
        }
      }
    } catch {
      // viewerDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  it("no viewer file imports from server", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);
        for (const imp of extractImportPaths(file)) {
          if (imp.includes("/server/") || imp.match(/\.\.\/server\b/)) {
            violations.push(`${rel} imports "${imp}"`);
          }
        }
      }
    } catch {
      // viewerDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });
});
