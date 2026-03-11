/**
 * Integration test coverage policy — ensures cross-package contract tests
 * grow proportionally with cross-package interactions.
 *
 * Without this guard, the integration ring has no mechanism to enforce
 * growth — unlike the e2e suite which has architecture-policy tests.
 *
 * Policy:
 * - Minimum number of integration test files must exist
 * - Each cross-package gateway must have corresponding contract coverage
 * - New gateways added without integration tests will fail this check
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Cross-package gateways that must have corresponding integration test
 * coverage. Each entry maps a gateway file to the contract it enforces.
 */
const REQUIRED_CONTRACTS = [
  {
    gateway: "packages/hench/src/prd/rex-gateway.ts",
    description: "hench → rex gateway contract",
  },
  {
    gateway: "packages/hench/src/prd/llm-gateway.ts",
    description: "hench → llm-client gateway contract",
  },
  {
    gateway: "packages/web/src/server/rex-gateway.ts",
    description: "web → rex gateway contract",
  },
  {
    gateway: "packages/web/src/server/domain-gateway.ts",
    description: "web → sourcevision gateway contract",
  },
];

/** Minimum number of integration test files at the monorepo boundary. */
const MIN_INTEGRATION_FILES = 5;

describe("integration test coverage policy", () => {
  const integrationDir = join(ROOT, "tests", "integration");

  it("integration test directory exists", () => {
    expect(
      existsSync(integrationDir),
      "tests/integration/ directory must exist",
    ).toBe(true);
  });

  it(`at least ${MIN_INTEGRATION_FILES} integration test files exist`, () => {
    const files = readdirSync(integrationDir).filter((f) =>
      f.endsWith(".test.js") || f.endsWith(".test.ts"),
    );

    expect(
      files.length,
      [
        `Expected at least ${MIN_INTEGRATION_FILES} integration test files,`,
        `found ${files.length}: ${files.join(", ") || "(none)"}`,
        "",
        "As cross-package interactions grow, integration tests must grow too.",
        "Add a test file to tests/integration/ for each new cross-package contract.",
      ].join("\n"),
    ).toBeGreaterThanOrEqual(MIN_INTEGRATION_FILES);
  });

  it("cross-package contract test covers gateway exports", () => {
    const contractTestPath = join(integrationDir, "cross-package-contracts.test.js");

    expect(
      existsSync(contractTestPath),
      "cross-package-contracts.test.js must exist in tests/integration/",
    ).toBe(true);

    const contractContent = readFileSync(contractTestPath, "utf-8");

    for (const contract of REQUIRED_CONTRACTS) {
      // The contract test should reference the gateway's upstream package
      // to validate its re-exports are correct
      const gatewayExists = existsSync(join(ROOT, contract.gateway));
      if (!gatewayExists) continue; // Gateway was removed, skip

      // Verify the test file mentions the gateway or its package
      const packageName = contract.gateway.split("/")[1]; // e.g. "hench", "web"
      const hasReference =
        contractContent.includes(packageName) ||
        contractContent.includes(contract.gateway);

      expect(
        hasReference,
        [
          `Integration test does not cover ${contract.description}`,
          `Gateway: ${contract.gateway}`,
          "",
          "Add contract assertions to tests/integration/cross-package-contracts.test.js",
        ].join("\n"),
      ).toBe(true);
    }
  });

  it("integration test count grows proportionally with e2e test count", () => {
    const e2eDir = join(ROOT, "tests", "e2e");
    const e2eFiles = existsSync(e2eDir)
      ? readdirSync(e2eDir).filter((f) => f.endsWith(".test.js") || f.endsWith(".test.ts"))
      : [];
    const integrationFiles = existsSync(integrationDir)
      ? readdirSync(integrationDir).filter((f) => f.endsWith(".test.js") || f.endsWith(".test.ts"))
      : [];

    // Integration tests should be at least 15% of e2e test count.
    // This ensures the integration tier grows as the test suite expands.
    const minRatio = 0.15;
    const minExpected = Math.max(MIN_INTEGRATION_FILES, Math.ceil(e2eFiles.length * minRatio));

    expect(
      integrationFiles.length,
      [
        `Integration test count (${integrationFiles.length}) is below the proportional minimum (${minExpected}).`,
        `E2E tests: ${e2eFiles.length}, required ratio: ${(minRatio * 100).toFixed(0)}%`,
        "",
        "Add integration tests for cross-package boundaries.",
        "See TESTING.md for required coverage scenarios.",
      ].join("\n"),
    ).toBeGreaterThanOrEqual(minExpected);
  });

  it("all gateway files referenced in REQUIRED_CONTRACTS exist on disk", () => {
    const missing = REQUIRED_CONTRACTS.filter(
      (c) => !existsSync(join(ROOT, c.gateway)),
    );

    if (missing.length > 0) {
      expect.fail(
        [
          "Gateway files listed in REQUIRED_CONTRACTS no longer exist on disk.",
          "Update the REQUIRED_CONTRACTS list in integration-coverage-policy.test.js:",
          "",
          ...missing.map((m) => `  - ${m.gateway} (${m.description})`),
        ].join("\n"),
      );
    }
  });
});
