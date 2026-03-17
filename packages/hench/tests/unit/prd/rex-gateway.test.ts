/**
 * Gateway compatibility test for hench → rex re-exports.
 *
 * Verifies that every function re-exported through rex-gateway.ts actually
 * exists in rex's public API and is callable. This catches rex API changes
 * at test time rather than at runtime inside an agent loop, where they are
 * expensive to diagnose.
 *
 * @see packages/hench/src/prd/rex-gateway.ts
 */

import { describe, it, expect } from "vitest";
import * as gateway from "../../../src/prd/rex-gateway.js";

/**
 * Expected re-exports from rex-gateway.ts.
 *
 * Keep this list in sync with the gateway file. If a function is added or
 * removed from the gateway, this test must be updated — ensuring deliberate
 * acknowledgment of cross-package surface changes.
 */
const EXPECTED_EXPORTS = [
  // Schema version
  "SCHEMA_VERSION",
  "isCompatibleSchema",
  "assertSchemaVersion",
  // Store factory
  "resolveStore",
  // Tree utilities
  "findItem",
  "walkTree",
  // Task selection
  "findNextTask",
  "findActionableTasks",
  "collectCompletedIds",
  // Timestamps
  "computeTimestampUpdates",
  // Parent auto-completion
  "findAutoCompletions",
  // Requirements validation
  "collectRequirements",
  "validateAutomatedRequirements",
  "formatRequirementsValidation",
  // Level helpers
  "isRootLevel",
  "isWorkItem",
  // Finding acknowledgment
  "loadAcknowledged",
  "saveAcknowledged",
  "acknowledgeFinding",
] as const;

describe("rex-gateway compatibility", () => {
  it("re-exports all expected symbols from rex", () => {
    const missing: string[] = [];

    for (const name of EXPECTED_EXPORTS) {
      const exported = (gateway as Record<string, unknown>)[name];
      if (exported === undefined) {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      expect.fail(
        `rex-gateway is missing exports: ${missing.join(", ")}.\n` +
        "This means rex's public API has changed. Update rex-gateway.ts and this test.",
      );
    }
  });

  it("does not have unexpected exports beyond the declared surface", () => {
    const actualExports = Object.keys(gateway);
    const expectedSet = new Set<string>(EXPECTED_EXPORTS);
    const unexpected = actualExports.filter((name) => !expectedSet.has(name));

    if (unexpected.length > 0) {
      expect.fail(
        `rex-gateway has undeclared exports: ${unexpected.join(", ")}.\n` +
        "Add new exports to the EXPECTED_EXPORTS list in this test to acknowledge " +
        "the expanded cross-package surface.",
      );
    }
  });

  // Constants (non-function exports) — SCHEMA_VERSION is a string constant
  const CONSTANT_EXPORTS = new Set(["SCHEMA_VERSION"]);

  // Verify each individual export to give clear diagnostics on failure
  for (const name of EXPECTED_EXPORTS) {
    if (CONSTANT_EXPORTS.has(name)) {
      it(`exports "${name}" as a constant`, () => {
        const exported = (gateway as Record<string, unknown>)[name];
        expect(exported).toBeDefined();
        expect(typeof exported).toBe("string");
      });
    } else {
      it(`exports "${name}" as a function`, () => {
        const exported = (gateway as Record<string, unknown>)[name];
        expect(exported).toBeDefined();
        expect(typeof exported).toBe("function");
      });
    }
  }
});
