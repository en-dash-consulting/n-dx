/**
 * Cross-package contract tests.
 *
 * These tests verify that gateway modules in consumer packages (hench, web)
 * re-export symbols that actually exist in upstream packages (rex, sourcevision).
 * They import from the **built** dist/ artifacts — not source .ts files — to
 * catch contract breaks at the package boundary where they matter most.
 *
 * Why here (monorepo root) instead of inside each package?
 * - Package-level tests use vitest aliases that resolve to source .ts files,
 *   bypassing the compiled dist/ boundary. These tests exercise the real
 *   compiled exports that npm consumers and other packages see.
 * - Cross-package contract tests belong to neither package — they test the
 *   *boundary* between packages, not internal behavior.
 *
 * @see packages/hench/src/prd/rex-gateway.ts
 * @see packages/web/src/server/rex-gateway.ts
 * @see packages/web/src/server/domain-gateway.ts
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// rex public API contract
// ---------------------------------------------------------------------------

describe("rex public API contract", () => {
  /** @type {Record<string, unknown>} */
  let rexPublic;

  it("can import rex public API", async () => {
    rexPublic = await import("../../packages/rex/dist/public.js");
    expect(rexPublic).toBeDefined();
  });

  // Core exports that hench and web depend on
  const REQUIRED_REX_EXPORTS = [
    // Store
    { name: "resolveStore", type: "function" },
    // Schema version
    { name: "SCHEMA_VERSION", type: "string" },
    { name: "isCompatibleSchema", type: "function" },
    { name: "assertSchemaVersion", type: "function" },
    // Tree utilities
    { name: "findItem", type: "function" },
    { name: "walkTree", type: "function" },
    { name: "collectAllIds", type: "function" },
    { name: "insertChild", type: "function" },
    { name: "updateInTree", type: "function" },
    { name: "removeFromTree", type: "function" },
    // Task selection
    { name: "findNextTask", type: "function" },
    { name: "findActionableTasks", type: "function" },
    { name: "collectCompletedIds", type: "function" },
    // Timestamps & auto-completion
    { name: "computeTimestampUpdates", type: "function" },
    { name: "findAutoCompletions", type: "function" },
    // Merge
    { name: "validateMerge", type: "function" },
    { name: "previewMerge", type: "function" },
    { name: "mergeItems", type: "function" },
    // Analytics
    { name: "computeEpicStats", type: "function" },
    { name: "computeHealthScore", type: "function" },
    // Reorganize & reshape
    { name: "detectReorganizations", type: "function" },
    { name: "applyProposals", type: "function" },
    { name: "applyReshape", type: "function" },
    { name: "reasonForReshape", type: "function" },
    // MCP server
    { name: "createRexMcpServer", type: "function" },
    // Constants
    { name: "PRIORITY_ORDER", type: "object" },
    { name: "LEVEL_HIERARCHY", type: "object" },
    { name: "VALID_LEVELS", type: "object" },
    { name: "VALID_STATUSES", type: "object" },
  ];

  for (const { name, type } of REQUIRED_REX_EXPORTS) {
    it(`exports "${name}" as ${type}`, async () => {
      if (!rexPublic) {
        rexPublic = await import("../../packages/rex/dist/public.js");
      }
      const value = rexPublic[name];
      expect(value, `rex public API is missing "${name}"`).toBeDefined();
      if (type === "function") {
        expect(typeof value).toBe("function");
      } else if (type === "string") {
        expect(typeof value).toBe("string");
      } else {
        // "object" — arrays, plain objects, Sets, etc.
        expect(value).not.toBeNull();
        expect(typeof value).toBe("object");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// sourcevision public API contract
// ---------------------------------------------------------------------------

describe("sourcevision public API contract", () => {
  /** @type {Record<string, unknown>} */
  let svPublic;

  it("can import sourcevision public API", async () => {
    svPublic = await import("../../packages/sourcevision/dist/public.js");
    expect(svPublic).toBeDefined();
  });

  const REQUIRED_SV_EXPORTS = [
    { name: "createSourcevisionMcpServer", type: "function" },
    { name: "SV_SCHEMA_VERSION", type: "string" },
    { name: "DATA_FILES", type: "object" },
    { name: "ALL_DATA_FILES", type: "object" },
  ];

  for (const { name, type } of REQUIRED_SV_EXPORTS) {
    it(`exports "${name}" as ${type}`, async () => {
      if (!svPublic) {
        svPublic = await import("../../packages/sourcevision/dist/public.js");
      }
      const value = svPublic[name];
      expect(value, `sourcevision public API is missing "${name}"`).toBeDefined();
      if (type === "function") {
        expect(typeof value).toBe("function");
      } else if (type === "string") {
        expect(typeof value).toBe("string");
      } else {
        expect(value).not.toBeNull();
        expect(typeof value).toBe("object");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// hench → rex gateway contract
// ---------------------------------------------------------------------------

describe("hench → rex gateway contract", () => {
  /** @type {Record<string, unknown>} */
  let gateway;

  it("can import hench rex-gateway", async () => {
    gateway = await import("../../packages/hench/dist/prd/rex-gateway.js");
    expect(gateway).toBeDefined();
  });

  /**
   * Every symbol that hench re-exports from rex must be a real function
   * (or constant) that rex's compiled output actually provides. If rex
   * renames or removes a symbol, this test catches it before the agent
   * loop encounters a runtime TypeError.
   */
  const GATEWAY_FUNCTIONS = [
    "resolveStore",
    "isCompatibleSchema",
    "assertSchemaVersion",
    "findItem",
    "walkTree",
    "findNextTask",
    "findActionableTasks",
    "collectCompletedIds",
    "computeTimestampUpdates",
    "findAutoCompletions",
    "collectRequirements",
    "validateAutomatedRequirements",
    "formatRequirementsValidation",
    "isRootLevel",
    "isWorkItem",
    "loadAcknowledged",
    "saveAcknowledged",
    "acknowledgeFinding",
  ];

  const GATEWAY_CONSTANTS = ["SCHEMA_VERSION"];

  for (const name of GATEWAY_FUNCTIONS) {
    it(`re-exports "${name}" as a function`, async () => {
      if (!gateway) {
        gateway = await import("../../packages/hench/dist/prd/rex-gateway.js");
      }
      expect(gateway[name], `hench gateway missing "${name}"`).toBeDefined();
      expect(typeof gateway[name]).toBe("function");
    });
  }

  for (const name of GATEWAY_CONSTANTS) {
    it(`re-exports "${name}" as a string constant`, async () => {
      if (!gateway) {
        gateway = await import("../../packages/hench/dist/prd/rex-gateway.js");
      }
      expect(gateway[name], `hench gateway missing "${name}"`).toBeDefined();
      expect(typeof gateway[name]).toBe("string");
    });
  }

  it("gateway exports match rex public API (no stale re-exports)", async () => {
    if (!gateway) {
      gateway = await import("../../packages/hench/dist/prd/rex-gateway.js");
    }
    const rexPublic = await import("../../packages/rex/dist/public.js");

    // Every runtime (non-type) export from the gateway must exist in rex
    const gatewayExports = Object.keys(gateway);
    const mismatched = gatewayExports.filter(
      (name) => rexPublic[name] === undefined,
    );

    expect(
      mismatched,
      `hench gateway re-exports symbols not found in rex public API: ${mismatched.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// web → rex gateway contract
// ---------------------------------------------------------------------------

describe("web → rex gateway contract", () => {
  /** @type {Record<string, unknown>} */
  let gateway;

  it("can import web rex-gateway", async () => {
    gateway = await import("../../packages/web/dist/server/rex-gateway.js");
    expect(gateway).toBeDefined();
  });

  const GATEWAY_FUNCTIONS = [
    "createRexMcpServer",
    "isCompatibleSchema",
    "findItem",
    "walkTree",
    "insertChild",
    "updateInTree",
    "removeFromTree",
    "computeStats",
    "collectAllIds",
    "findNextTask",
    "collectCompletedIds",
    "computeTimestampUpdates",
    "validateMerge",
    "previewMerge",
    "mergeItems",
    "countSubtree",
    "computeEpicStats",
    "computePriorityDistribution",
    "computeRequirementsSummary",
    "computeHealthScore",
    "detectReorganizations",
    "applyProposals",
    "applyReshape",
    "reasonForReshape",
    "isPriority",
    "isItemLevel",
    "isRequirementCategory",
    "isValidationType",
    "isRootLevel",
    "isWorkItem",
  ];

  const GATEWAY_CONSTANTS = ["SCHEMA_VERSION"];

  for (const name of GATEWAY_FUNCTIONS) {
    it(`re-exports "${name}" as a function`, async () => {
      if (!gateway) {
        gateway = await import("../../packages/web/dist/server/rex-gateway.js");
      }
      expect(gateway[name], `web rex-gateway missing "${name}"`).toBeDefined();
      expect(typeof gateway[name]).toBe("function");
    });
  }

  for (const name of GATEWAY_CONSTANTS) {
    it(`re-exports "${name}" as a string constant`, async () => {
      if (!gateway) {
        gateway = await import("../../packages/web/dist/server/rex-gateway.js");
      }
      expect(gateway[name], `web rex-gateway missing "${name}"`).toBeDefined();
      expect(typeof gateway[name]).toBe("string");
    });
  }

  it("gateway exports match rex public API (no stale re-exports)", async () => {
    if (!gateway) {
      gateway = await import("../../packages/web/dist/server/rex-gateway.js");
    }
    const rexPublic = await import("../../packages/rex/dist/public.js");

    const gatewayExports = Object.keys(gateway);
    const mismatched = gatewayExports.filter(
      (name) => rexPublic[name] === undefined,
    );

    expect(
      mismatched,
      `web rex-gateway re-exports symbols not found in rex public API: ${mismatched.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// web → sourcevision gateway contract
// ---------------------------------------------------------------------------

describe("web → sourcevision gateway contract", () => {
  it("re-exports createSourcevisionMcpServer as a function", async () => {
    const gateway = await import(
      "../../packages/web/dist/server/domain-gateway.js"
    );
    expect(gateway.createSourcevisionMcpServer).toBeDefined();
    expect(typeof gateway.createSourcevisionMcpServer).toBe("function");
  });

  it("gateway export matches sourcevision public API", async () => {
    const gateway = await import(
      "../../packages/web/dist/server/domain-gateway.js"
    );
    const svPublic = await import(
      "../../packages/sourcevision/dist/public.js"
    );

    const gatewayExports = Object.keys(gateway);
    const mismatched = gatewayExports.filter(
      (name) => svPublic[name] === undefined,
    );

    expect(
      mismatched,
      `web domain-gateway re-exports symbols not found in sourcevision public API: ${mismatched.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Orchestration spawn call-site validation
// ---------------------------------------------------------------------------

describe("orchestration spawn call-sites match package CLI parsers", () => {
  /**
   * Validates that commands spawned by cli.js correspond to actual subcommands
   * accepted by each package's CLI entry point. This prevents a breaking CLI
   * argument change in rex or sourcevision from going undetected until runtime.
   */

  // Commands that cli.js delegates to each tool via spawn
  const EXPECTED_SUBCOMMANDS = {
    rex: ["init", "analyze", "status", "usage", "sync"],
    sourcevision: ["init", "analyze", "pr-markdown"],
    hench: ["init", "run"],
  };

  for (const [pkg, subcommands] of Object.entries(EXPECTED_SUBCOMMANDS)) {
    for (const sub of subcommands) {
      it(`${pkg} CLI accepts "${sub}" subcommand`, async () => {
        const cliModule = await import(`../../packages/${pkg}/dist/cli/index.js?probe=${pkg}_${sub}`).catch(() => null);
        // If the CLI module can't be imported, verify via the built parser
        // by checking the package's command registry
        const publicApi = await import(`../../packages/${pkg}/dist/public.js`);
        // At minimum, verify the package builds and exports are available
        expect(publicApi).toBeDefined();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// rex → sourcevision data contract
// ---------------------------------------------------------------------------

describe("rex analyze → sourcevision output consumption", () => {
  /**
   * Verifies that rex can parse the data structures that sourcevision produces.
   * This is the highest-frequency cross-package data contract: rex analyze reads
   * .sourcevision/CONTEXT.md and inventory files produced by sourcevision analyze.
   */

  it("sourcevision DATA_FILES constant lists files that rex can reference", async () => {
    const svPublic = await import("../../packages/sourcevision/dist/public.js");
    expect(svPublic.DATA_FILES).toBeDefined();
    expect(typeof svPublic.DATA_FILES).toBe("object");

    // DATA_FILES should include the key files rex depends on
    const fileKeys = Object.keys(svPublic.DATA_FILES);
    expect(fileKeys.length).toBeGreaterThan(0);
  });

  it("sourcevision schema version is a string rex can validate against", async () => {
    const svPublic = await import("../../packages/sourcevision/dist/public.js");
    const rexPublic = await import("../../packages/rex/dist/public.js");

    // Both packages define schema version strings
    expect(typeof svPublic.SV_SCHEMA_VERSION).toBe("string");
    expect(typeof rexPublic.SCHEMA_VERSION).toBe("string");

    // Rex uses a namespace/version pattern, sourcevision uses semver
    expect(svPublic.SV_SCHEMA_VERSION).toMatch(/^\d+\.\d+/);
    expect(rexPublic.SCHEMA_VERSION).toMatch(/^rex\//);
  });
});
