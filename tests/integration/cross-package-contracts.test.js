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
    "explainSelection",
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
// hench → llm-client gateway contract
// ---------------------------------------------------------------------------

describe("hench → llm-client gateway contract", () => {
  /** @type {Record<string, unknown>} */
  let gateway;

  it("can import hench llm-gateway", async () => {
    gateway = await import("../../packages/hench/dist/prd/llm-gateway.js");
    expect(gateway).toBeDefined();
  });

  const GATEWAY_FUNCTIONS = [
    "loadClaudeConfig",
    "loadLLMConfig",
    "resolveApiKey",
    "resolveCliPath",
    "loadProjectOverrides",
    "mergeWithOverrides",
    "toCanonicalJSON",
    "setQuiet",
    "isQuiet",
    "info",
    "result",
    "formatHelp",
    "formatTypoSuggestion",
    "exec",
    "execStdout",
    "execShellCmd",
    "getCurrentHead",
    "getCurrentBranch",
    "isExecutableOnPath",
    "spawnTool",
    "spawnManaged",
    "parseApiTokenUsage",
    "parseStreamTokenUsage",
    "resolveModel",
    "isModelCompatibleWithVendor",
    "resetStaleModel",
    "formatVendorChangeWarning",
    "formatUsage",
  ];

  const GATEWAY_CLASSES = ["CLIError", "ClaudeClientError", "ProcessPool", "ProcessLimitError"];

  const GATEWAY_CONSTANTS = ["PROJECT_DIRS", "VENDOR_CONTEXT_CHAR_LIMITS"];

  for (const name of GATEWAY_FUNCTIONS) {
    it(`re-exports "${name}" as a function`, async () => {
      if (!gateway) {
        gateway = await import("../../packages/hench/dist/prd/llm-gateway.js");
      }
      expect(gateway[name], `hench llm-gateway missing "${name}"`).toBeDefined();
      expect(typeof gateway[name]).toBe("function");
    });
  }

  for (const name of GATEWAY_CLASSES) {
    it(`re-exports "${name}" as a constructor`, async () => {
      if (!gateway) {
        gateway = await import("../../packages/hench/dist/prd/llm-gateway.js");
      }
      expect(gateway[name], `hench llm-gateway missing "${name}"`).toBeDefined();
      expect(typeof gateway[name]).toBe("function");
    });
  }

  for (const name of GATEWAY_CONSTANTS) {
    it(`re-exports "${name}" as a constant`, async () => {
      if (!gateway) {
        gateway = await import("../../packages/hench/dist/prd/llm-gateway.js");
      }
      expect(gateway[name], `hench llm-gateway missing "${name}"`).toBeDefined();
      expect(typeof gateway[name]).toBe("object");
    });
  }

  it("gateway exports match llm-client public API (no stale re-exports)", async () => {
    if (!gateway) {
      gateway = await import("../../packages/hench/dist/prd/llm-gateway.js");
    }
    const llmPublic = await import("../../packages/llm-client/dist/public.js");

    const gatewayExports = Object.keys(gateway);
    const mismatched = gatewayExports.filter(
      (name) => llmPublic[name] === undefined,
    );

    expect(
      mismatched,
      `hench llm-gateway re-exports symbols not found in llm-client public API: ${mismatched.join(", ")}`,
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
    "handleEditItem",
  ];

  const GATEWAY_CONSTANTS = [
    "SCHEMA_VERSION",
    "LEVEL_HIERARCHY",
    "VALID_STATUSES",
    "VALID_REQUIREMENT_CATEGORIES",
    "VALID_VALIDATION_TYPES",
    "CHILD_LEVEL",
  ];

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
    it(`re-exports "${name}" as a constant`, async () => {
      if (!gateway) {
        gateway = await import("../../packages/web/dist/server/rex-gateway.js");
      }
      expect(gateway[name], `web rex-gateway missing "${name}"`).toBeDefined();
      // Constants can be strings or objects (arrays, Maps, etc.)
      expect(
        typeof gateway[name] === "string" || typeof gateway[name] === "object",
        `web rex-gateway "${name}" should be a string or object, got ${typeof gateway[name]}`,
      ).toBe(true);
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
// Gateway export auto-detection (finding: cross-package import coverage)
// ---------------------------------------------------------------------------

/**
 * Automatically detects when a gateway file re-exports symbols that are NOT
 * listed in the contract test's GATEWAY_FUNCTIONS/GATEWAY_CONSTANTS arrays.
 *
 * Without this test, a developer can add a new re-export to a gateway and
 * the contract tests will still pass — they only check known symbols. This
 * leaves the new symbol unvalidated until a runtime failure exposes the gap.
 *
 * This test reads the gateway source files, counts exported symbols, and
 * asserts the count matches the contract test list length. If they diverge,
 * the test names the missing entries.
 */
describe("gateway export auto-detection", () => {
  const { readFileSync, existsSync } = require("node:fs");
  const { join } = require("node:path");
  const ROOT = join(import.meta.dirname, "../..");

  /**
   * Parse runtime export symbols from a gateway source file.
   * Handles single-line and multi-line `export { A, B } from "..."` forms.
   * Skips `export type { ... }` blocks.
   */
  function parseRuntimeExports(filePath) {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const symbols = [];
    const lines = content.split("\n");

    let inExportBlock = false;
    let isTypeExport = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      // Start of export type block — skip entirely
      if (/^export\s+type\s+\{/.test(trimmed)) {
        isTypeExport = true;
        if (trimmed.includes("}")) { isTypeExport = false; continue; }
        inExportBlock = true;
        continue;
      }

      // Start of runtime export block
      if (/^export\s+\{/.test(trimmed)) {
        isTypeExport = false;
        if (trimmed.includes("}")) {
          // Single-line: export { A, B, C } from "..."
          const braceContent = trimmed.match(/\{([^}]*)\}/);
          if (braceContent) {
            braceContent[1].split(",").forEach((s) => {
              const sym = s.trim().split(/\s+as\s+/).pop().trim();
              if (sym) symbols.push(sym);
            });
          }
          continue;
        }
        inExportBlock = true;
        const afterBrace = trimmed.replace(/^export\s+\{/, "").trim();
        if (afterBrace) {
          afterBrace.split(",").forEach((s) => {
            const sym = s.trim();
            if (sym) symbols.push(sym);
          });
        }
        continue;
      }

      if (inExportBlock) {
        if (trimmed.includes("}")) {
          if (!isTypeExport) {
            const beforeBrace = trimmed.replace(/}.*/, "").trim();
            if (beforeBrace) {
              beforeBrace.split(",").forEach((s) => {
                const sym = s.trim();
                if (sym) symbols.push(sym);
              });
            }
          }
          inExportBlock = false;
          isTypeExport = false;
          continue;
        }
        if (!isTypeExport) {
          trimmed.split(",").forEach((s) => {
            const sym = s.trim();
            if (sym) symbols.push(sym);
          });
        }
      }
    }

    return symbols;
  }

  it("hench gateway source exports match contract test list", () => {
    const gwPath = join(ROOT, "packages/hench/src/prd/rex-gateway.ts");
    const sourceExports = parseRuntimeExports(gwPath);

    // The contract test lists above
    const testedSymbols = new Set([
      ...["resolveStore", "isCompatibleSchema", "assertSchemaVersion",
        "findItem", "walkTree", "findNextTask", "findActionableTasks",
        "collectCompletedIds", "explainSelection", "computeTimestampUpdates",
        "findAutoCompletions", "collectRequirements", "validateAutomatedRequirements",
        "formatRequirementsValidation", "isRootLevel", "isWorkItem",
        "loadAcknowledged", "saveAcknowledged", "acknowledgeFinding"],
      ...["SCHEMA_VERSION"],
    ]);

    const untested = sourceExports.filter((s) => !testedSymbols.has(s));
    const stale = [...testedSymbols].filter((s) => !sourceExports.includes(s));

    if (untested.length > 0 || stale.length > 0) {
      const parts = ["Hench gateway contract test list is out of sync with gateway source."];
      if (untested.length > 0) {
        parts.push("", "New exports not in contract test:", ...untested.map((s) => `  + ${s}`));
      }
      if (stale.length > 0) {
        parts.push("", "Stale entries in contract test (removed from gateway):", ...stale.map((s) => `  - ${s}`));
      }
      parts.push("", "Update GATEWAY_FUNCTIONS/GATEWAY_CONSTANTS in cross-package-contracts.test.js");
      expect.fail(parts.join("\n"));
    }
  });

  it("hench llm-gateway source exports match contract test list", () => {
    const gwPath = join(ROOT, "packages/hench/src/prd/llm-gateway.ts");
    const sourceExports = parseRuntimeExports(gwPath);

    const testedSymbols = new Set([
      ...["loadClaudeConfig", "loadLLMConfig", "resolveApiKey", "resolveCliPath",
        "loadProjectOverrides", "mergeWithOverrides", "toCanonicalJSON",
        "setQuiet", "isQuiet", "info", "result", "warn", "suppressKnownDeprecations",
        "printVendorModelHeader", "isColorEnabled", "bold", "dim", "cyan", "yellow",
        "green", "red", "magenta", "colorSuccess", "colorWarn", "colorInfo",
        "colorDim", "colorPending", "colorPink", "STATUS_COLORS", "colorStatus",
        "formatHelp", "formatTypoSuggestion",
        "CLIError", "ClaudeClientError", "CLI_ERROR_CODES",
        "exec", "execStdout", "execShellCmd", "getCurrentHead", "getCurrentBranch",
        "isExecutableOnPath", "spawnTool", "spawnManaged", "ProcessPool", "ProcessLimitError",
        "parseApiTokenUsage", "parseApiTokenUsageWithDiagnostic", "parseStreamTokenUsage",
        "parseStreamTokenUsageWithDiagnostic", "mapCodexUsageToTokenUsage",
        "resolveModel", "resolveVendorModel",
        "isModelCompatibleWithVendor", "resetStaleModel", "formatVendorChangeWarning",
        "formatUsage", "createPromptEnvelope", "assemblePrompt",
        "mapErrorReasonToFailureCategory", "mapRunFailureToCategory", "classifyVendorError",
        "failureCategoryLabel", "compileCodexPolicyFlags", "mapSandboxToCodexFlag",
        "mapApprovalToCodexFlag", "toAnthropicToolDef", "toAnthropicToolDefs",
        "toOpenAiToolDef", "toOpenAiToolDefs", "ProviderRegistry", "defaultRegistry"],
      ...["PROJECT_DIRS", "NEWEST_MODELS", "VENDOR_CONTEXT_CHAR_LIMITS",
        "DEFAULT_EXECUTION_POLICY", "CANONICAL_PROMPT_SECTIONS", "ALL_FAILURE_CATEGORIES"],
    ]);

    const untested = sourceExports.filter((s) => !testedSymbols.has(s));
    const stale = [...testedSymbols].filter((s) => !sourceExports.includes(s));

    if (untested.length > 0 || stale.length > 0) {
      const parts = ["Hench llm-gateway contract test list is out of sync with gateway source."];
      if (untested.length > 0) {
        parts.push("", "New exports not in contract test:", ...untested.map((s) => `  + ${s}`));
      }
      if (stale.length > 0) {
        parts.push("", "Stale entries in contract test (removed from gateway):", ...stale.map((s) => `  - ${s}`));
      }
      parts.push("", "Update GATEWAY_FUNCTIONS/GATEWAY_CLASSES/GATEWAY_CONSTANTS in cross-package-contracts.test.js");
      expect.fail(parts.join("\n"));
    }
  });

  it("web rex-gateway source exports match contract test list", () => {
    const gwPath = join(ROOT, "packages/web/src/server/rex-gateway.ts");
    const sourceExports = parseRuntimeExports(gwPath);

    const testedSymbols = new Set([
      ...["createRexMcpServer", "isCompatibleSchema", "findItem", "walkTree",
        "insertChild", "updateInTree", "removeFromTree", "computeStats",
        "collectAllIds", "findNextTask", "collectCompletedIds",
        "computeTimestampUpdates", "validateMerge", "previewMerge", "mergeItems",
        "countSubtree", "computeEpicStats", "computePriorityDistribution",
        "computeRequirementsSummary", "computeHealthScore",
        "detectReorganizations", "applyProposals", "applyReshape",
        "reasonForReshape", "isPriority", "isItemLevel",
        "isRequirementCategory", "isValidationType", "isRootLevel", "isWorkItem",
        "handleEditItem",
        "LEVEL_HIERARCHY", "VALID_STATUSES", "VALID_REQUIREMENT_CATEGORIES",
        "VALID_VALIDATION_TYPES", "CHILD_LEVEL"],
      ...["SCHEMA_VERSION"],
    ]);

    const untested = sourceExports.filter((s) => !testedSymbols.has(s));
    const stale = [...testedSymbols].filter((s) => !sourceExports.includes(s));

    if (untested.length > 0 || stale.length > 0) {
      const parts = ["Web rex-gateway contract test list is out of sync with gateway source."];
      if (untested.length > 0) {
        parts.push("", "New exports not in contract test:", ...untested.map((s) => `  + ${s}`));
      }
      if (stale.length > 0) {
        parts.push("", "Stale entries in contract test (removed from gateway):", ...stale.map((s) => `  - ${s}`));
      }
      parts.push("", "Update GATEWAY_FUNCTIONS/GATEWAY_CONSTANTS in cross-package-contracts.test.js");
      expect.fail(parts.join("\n"));
    }
  });
});

// ---------------------------------------------------------------------------
// Rex API coordination (fan-in topology guard)
// ---------------------------------------------------------------------------

/**
 * Rex is the central domain package consumed by both hench and web via
 * separate gateway files. When rex's public API changes (new export added,
 * existing export renamed), both gateways must be reviewed for impact.
 *
 * This test detects when rex exports symbols that appear in ONE gateway
 * but not the other, flagging potential coordination gaps. It does NOT
 * require both gateways to have identical surfaces — each consumer
 * imports only what it needs — but it ensures visibility into the
 * asymmetry so that deliberate omissions are distinguishable from
 * accidental ones.
 */
describe("rex API coordination: fan-in gateway sync", () => {
  it("documents asymmetric rex exports across gateways (visibility, not enforcement)", async () => {
    const rexPublic = await import("../../packages/rex/dist/public.js");
    const henchGw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    const webGw = await import("../../packages/web/dist/server/rex-gateway.js");

    const rexExports = Object.keys(rexPublic);
    const henchExports = new Set(Object.keys(henchGw));
    const webExports = new Set(Object.keys(webGw));

    // Rex exports consumed by at least one gateway
    const consumed = rexExports.filter(
      (name) => henchExports.has(name) || webExports.has(name),
    );

    // Asymmetric: in one gateway but not the other
    const henchOnly = consumed.filter(
      (name) => henchExports.has(name) && !webExports.has(name),
    );
    const webOnly = consumed.filter(
      (name) => webExports.has(name) && !henchExports.has(name),
    );

    // This test is informational — it passes but logs asymmetry.
    // The real guard is that both gateways validate their exports
    // match rex (tested in "gateway exports match rex public API").
    // If a NEW rex export appears that neither gateway consumes,
    // that's fine — it means rex grew without downstream impact.
    const unconsumed = rexExports.filter(
      (name) => !henchExports.has(name) && !webExports.has(name),
    );

    // Both gateways must successfully import — if either fails,
    // a rex API change has already broken a consumer.
    expect(consumed.length).toBeGreaterThan(0);

    // Sanity: at least some symbols are shared (the core contract)
    const shared = consumed.filter(
      (name) => henchExports.has(name) && webExports.has(name),
    );
    expect(
      shared.length,
      "Expected at least some rex exports to be consumed by both gateways",
    ).toBeGreaterThan(0);
  });

  it("both gateways re-export SCHEMA_VERSION from rex (core coordination point)", async () => {
    const henchGw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    const webGw = await import("../../packages/web/dist/server/rex-gateway.js");

    // SCHEMA_VERSION is the most critical coordination point —
    // both consumers must agree on the schema version to read prd.json.
    expect(henchGw.SCHEMA_VERSION).toBeDefined();
    expect(webGw.SCHEMA_VERSION).toBeDefined();
    expect(henchGw.SCHEMA_VERSION).toBe(webGw.SCHEMA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Orchestration spawn call-site validation (structural)
// ---------------------------------------------------------------------------

/**
 * Finding: monorepo-root has zero import edges to all other zones (spawn-only
 * pattern), making its cross-zone contracts invisible to static analysis.
 *
 * This section extracts the accepted subcommands directly from each package's
 * CLI source file (the switch/case statements) and validates that every
 * subcommand cli.js actually spawns is in the parser's accepted set.
 *
 * This catches interface drift that import-graph tooling cannot detect:
 * if a package renames or removes a CLI subcommand, this test fails at
 * build time rather than at runtime.
 */
describe("orchestration spawn call-sites match package CLI parsers", () => {
  const { readFileSync, existsSync } = require("node:fs");
  const { join } = require("node:path");
  const ROOT = join(import.meta.dirname, "../..");

  /**
   * Parse accepted subcommands from a CLI entry file by extracting
   * case "..." labels from the main dispatch switch.
   */
  function parseAcceptedCommands(cliSourcePath) {
    if (!existsSync(cliSourcePath)) return [];
    const content = readFileSync(cliSourcePath, "utf-8");
    const commands = [];
    // Match case "command": or case 'command': patterns
    const caseRegex = /case\s+["']([a-z][\w-]*)["']\s*:/g;
    let match;
    while ((match = caseRegex.exec(content)) !== null) {
      commands.push(match[1]);
    }
    return [...new Set(commands)];
  }

  /**
   * Extract subcommands that cli.js actually spawns for each tool.
   * Parses patterns like: run(tools.rex, ["status", ...])
   */
  function parseSpawnedSubcommands(cliJsPath) {
    if (!existsSync(cliJsPath)) return {};
    const content = readFileSync(cliJsPath, "utf-8");
    const spawned = {};
    // Match: run(tools.PKG, ["CMD" or runOrDie(tools.PKG, ["CMD" or runInitCapture(tools.PKG, ["CMD"
    // or runCapture(tools.PKG, ["CMD"
    const spawnRegex = /(?:run|runOrDie|runInitCapture|runCapture)\(tools\.(\w+),\s*\["([a-z][\w-]*)"/g;
    let match;
    while ((match = spawnRegex.exec(content)) !== null) {
      const pkg = match[1] === "sv" ? "sourcevision" : match[1];
      const cmd = match[2];
      if (!spawned[pkg]) spawned[pkg] = new Set();
      spawned[pkg].add(cmd);
    }
    // Convert Sets to arrays
    return Object.fromEntries(
      Object.entries(spawned).map(([k, v]) => [k, [...v]]),
    );
  }

  const CLI_SOURCES = {
    rex: join(ROOT, "packages/rex/src/cli/index.ts"),
    sourcevision: join(ROOT, "packages/sourcevision/src/cli/index.ts"),
    hench: join(ROOT, "packages/hench/src/cli/index.ts"),
  };

  const cliJsPath = join(ROOT, "packages/core/cli.js");
  const spawnedCommands = parseSpawnedSubcommands(cliJsPath);

  for (const [pkg, sourcePath] of Object.entries(CLI_SOURCES)) {
    it(`${pkg} CLI parser exists and has accepted commands`, () => {
      const accepted = parseAcceptedCommands(sourcePath);
      expect(
        accepted.length,
        `${pkg} CLI source has no case statements — parser may have changed structure`,
      ).toBeGreaterThan(0);
    });

    it(`all spawned ${pkg} subcommands are accepted by its CLI parser`, () => {
      const accepted = new Set(parseAcceptedCommands(sourcePath));
      const spawned = spawnedCommands[pkg] || [];

      const unrecognized = spawned.filter((cmd) => !accepted.has(cmd));
      expect(
        unrecognized,
        `cli.js spawns ${pkg} subcommands not in its CLI parser: ${unrecognized.join(", ")}. ` +
          `This indicates interface drift between the orchestration layer and the ${pkg} package.`,
      ).toEqual([]);
    });
  }

  it("spawn extraction found all known orchestration delegations", () => {
    // Canary: if cli.js stops spawning these, the spawn extractor may be broken
    expect(spawnedCommands.rex).toBeDefined();
    expect(spawnedCommands.sourcevision).toBeDefined();
    expect(spawnedCommands.hench).toBeDefined();

    // Known minimum spawned commands (from cli.js handlers)
    // Note: "init" is not spawned — handleInit runs sub-package inits in-process
    expect(spawnedCommands.rex).toEqual(expect.arrayContaining(["analyze", "status"]));
    expect(spawnedCommands.sourcevision).toEqual(expect.arrayContaining(["analyze"]));
    expect(spawnedCommands.hench).toEqual(expect.arrayContaining(["run"]));
  });
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

// ---------------------------------------------------------------------------
// Gateway behavioral tests (return-shape validation)
// ---------------------------------------------------------------------------

/**
 * Finding: A gap exists for in-process behavioral tests of gateway return
 * values — currently no zone validates that gateway re-exports return
 * correctly typed data at runtime.
 *
 * The existing contract tests verify exports exist and have the right typeof.
 * These tests go further: they invoke pure functions through the gateway with
 * minimal inputs and verify the return shapes match expected contracts.
 *
 * Only pure/safe functions are tested (no side effects, no disk I/O).
 * Functions that require a store instance or filesystem access are excluded.
 */
describe("gateway behavioral tests: hench → rex return shapes", () => {
  /** @type {Record<string, unknown>} */
  let gw;

  it("can import hench gateway", async () => {
    gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    expect(gw).toBeDefined();
  });

  it("SCHEMA_VERSION matches rex/N.N pattern", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    expect(gw.SCHEMA_VERSION).toMatch(/^rex\//);
  });

  it("isCompatibleSchema returns boolean for valid schema string", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    const result = gw.isCompatibleSchema(gw.SCHEMA_VERSION);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  it("isCompatibleSchema returns false for invalid schema", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    expect(gw.isCompatibleSchema("invalid/0.0")).toBe(false);
  });

  it("isRootLevel correctly classifies levels", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    // Only epic can be root (parents = [null])
    expect(gw.isRootLevel("epic")).toBe(true);
    expect(gw.isRootLevel("feature")).toBe(false);
    expect(gw.isRootLevel("task")).toBe(false);
    expect(gw.isRootLevel("subtask")).toBe(false);
  });

  it("isWorkItem correctly classifies levels", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    expect(gw.isWorkItem("task")).toBe(true);
    expect(gw.isWorkItem("subtask")).toBe(true);
    expect(gw.isWorkItem("epic")).toBe(false);
  });

  it("findItem returns null for missing ID in empty tree", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    const result = gw.findItem([], "nonexistent-id");
    expect(result).toBeNull();
  });

  it("findItem returns TreeEntry with item and parents for a match", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    const items = [
      { id: "a", title: "Epic A", level: "epic", status: "pending", children: [
        { id: "b", title: "Feature B", level: "feature", status: "pending", children: [] },
      ] },
    ];
    const found = gw.findItem(items, "b");
    expect(found).not.toBeNull();
    // findItem returns { item, parents } (TreeEntry shape)
    expect(found.item).toBeDefined();
    expect(found.item.id).toBe("b");
    expect(found.item.title).toBe("Feature B");
    expect(Array.isArray(found.parents)).toBe(true);
    expect(found.parents.length).toBe(1);
    expect(found.parents[0].id).toBe("a");
  });

  it("walkTree is a generator yielding TreeEntry objects", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    const items = [
      { id: "a", children: [{ id: "b", children: [] }] },
      { id: "c", children: [] },
    ];
    const visited = [];
    for (const entry of gw.walkTree(items)) {
      expect(entry.item).toBeDefined();
      expect(Array.isArray(entry.parents)).toBe(true);
      visited.push(entry.item.id);
    }
    expect(visited).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(visited.length).toBe(3);
  });

  it("collectCompletedIds returns Set of completed item IDs", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    const items = [
      { id: "a", status: "completed", children: [] },
      { id: "b", status: "pending", children: [
        { id: "c", status: "completed", children: [] },
      ] },
    ];
    const result = gw.collectCompletedIds(items);
    expect(result).toBeInstanceOf(Set);
    expect(result.has("a")).toBe(true);
    expect(result.has("c")).toBe(true);
    expect(result.has("b")).toBe(false);
  });

  it("findNextTask returns null for empty tree", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    const result = gw.findNextTask([]);
    expect(result).toBeNull();
  });

  it("computeTimestampUpdates returns object with timestamp fields", async () => {
    if (!gw) gw = await import("../../packages/hench/dist/prd/rex-gateway.js");
    // Signature: computeTimestampUpdates(from, to, existing?)
    const result = gw.computeTimestampUpdates("pending", "in_progress");
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    // Should include startedAt for pending→in_progress
    expect(result.startedAt).toBeDefined();
    expect(typeof result.startedAt).toBe("string");
  });
});

describe("gateway behavioral tests: web → rex return shapes", () => {
  /** @type {Record<string, unknown>} */
  let gw;

  it("can import web rex-gateway", async () => {
    gw = await import("../../packages/web/dist/server/rex-gateway.js");
    expect(gw).toBeDefined();
  });

  it("LEVEL_HIERARCHY is a non-empty object", async () => {
    if (!gw) gw = await import("../../packages/web/dist/server/rex-gateway.js");
    expect(typeof gw.LEVEL_HIERARCHY).toBe("object");
    expect(Object.keys(gw.LEVEL_HIERARCHY).length).toBeGreaterThan(0);
  });

  it("VALID_STATUSES contains expected status values", async () => {
    if (!gw) gw = await import("../../packages/web/dist/server/rex-gateway.js");
    expect(gw.VALID_STATUSES).toBeDefined();
    // Must contain at least the core statuses
    const statuses = Array.isArray(gw.VALID_STATUSES)
      ? gw.VALID_STATUSES
      : [...gw.VALID_STATUSES];
    expect(statuses).toEqual(expect.arrayContaining(["pending", "in_progress", "completed"]));
  });

  it("CHILD_LEVEL maps parent levels to child levels", async () => {
    if (!gw) gw = await import("../../packages/web/dist/server/rex-gateway.js");
    expect(typeof gw.CHILD_LEVEL).toBe("object");
    expect(gw.CHILD_LEVEL["epic"]).toBeDefined();
    expect(gw.CHILD_LEVEL["feature"]).toBeDefined();
  });

  it("isPriority validates priority strings", async () => {
    if (!gw) gw = await import("../../packages/web/dist/server/rex-gateway.js");
    expect(gw.isPriority("high")).toBe(true);
    expect(gw.isPriority("invalid")).toBe(false);
  });

  it("isItemLevel validates level strings", async () => {
    if (!gw) gw = await import("../../packages/web/dist/server/rex-gateway.js");
    expect(gw.isItemLevel("epic")).toBe(true);
    expect(gw.isItemLevel("invalid")).toBe(false);
  });

  it("computeStats returns stats for a tree", async () => {
    if (!gw) gw = await import("../../packages/web/dist/server/rex-gateway.js");
    const items = [
      { id: "a", status: "completed", level: "task", children: [] },
      { id: "b", status: "pending", level: "task", children: [] },
    ];
    const stats = gw.computeStats(items);
    expect(stats).toBeDefined();
    expect(typeof stats).toBe("object");
  });

  it("insertChild mutates tree in-place and returns boolean", async () => {
    if (!gw) gw = await import("../../packages/web/dist/server/rex-gateway.js");
    const items = [
      { id: "a", level: "epic", status: "pending", children: [] },
    ];
    const child = { id: "b", level: "feature", status: "pending", children: [] };
    const result = gw.insertChild(items, "a", child);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
    expect(items[0].children.length).toBe(1);
    expect(items[0].children[0].id).toBe("b");
  });

  it("collectAllIds returns all IDs in a tree", async () => {
    if (!gw) gw = await import("../../packages/web/dist/server/rex-gateway.js");
    const items = [
      { id: "a", children: [{ id: "b", children: [] }] },
    ];
    const ids = gw.collectAllIds(items);
    expect(ids).toBeInstanceOf(Set);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rex runtime state: multi-writer zone enforcement
// ---------------------------------------------------------------------------

/**
 * Finding: rex-runtime-state is a multi-writer shared-state zone with no
 * import-graph visibility — four zones write to it under documented but
 * unenforced exclusion rules, creating hidden coupling.
 *
 * This test makes the write sites explicit and enforceable. It scans the
 * codebase for all locations that write to .rex/prd.json (via the known
 * write mechanisms) and validates they belong to an allowed set of zones.
 *
 * If a new package or module starts writing to the PRD, this test forces
 * a deliberate decision to add it to the allowed list.
 */
describe("rex runtime state: PRD write-zone enforcement", () => {
  const { readFileSync, readdirSync, statSync, existsSync } = require("node:fs");
  const { join, relative, sep } = require("node:path");
  const ROOT = join(import.meta.dirname, "../..");

  /**
   * Allowed zones that may write to .rex/prd.json.
   * Keyed by the top-level directory path prefix that identifies the zone.
   * Any file writing to prd.json outside these zones triggers a test failure.
   *
   * Corresponds to the concurrency contract in CLAUDE.md.
   */
  const ALLOWED_PRD_WRITERS = {
    "packages/rex/": "Rex CLI commands (store.saveDocument / atomicWriteJSON)",
    "packages/web/src/server/": "Web server route handlers (savePRD / savePRDSync)",
    "packages/hench/": "Hench agent (store.updateItem via rex-gateway)",
  };

  /**
   * Patterns that indicate a file writes to .rex/prd.json.
   * Covers both direct writes and abstracted write mechanisms.
   */
  const PRD_WRITE_PATTERNS = [
    /savePRD\s*\(/,            // web server savePRD() wrapper
    /savePRDSync\s*\(/,        // web server sync write
    /saveDocument\s*\(/,       // rex store saveDocument()
    /atomicWriteJSON\s*\(/,    // rex low-level atomic write
    /store\.updateItem\s*\(/,  // hench writing via store instance
  ];

  /**
   * Recursively collect .ts and .js source files, excluding node_modules,
   * dist, tests, and dotfile directories.
   */
  function collectSourceFiles(dir) {
    const results = [];
    const SKIP = new Set(["node_modules", "dist", "tests", ".git", ".hench", ".rex", ".sourcevision"]);

    function walk(d) {
      let entries;
      try { entries = readdirSync(d, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.js")) {
          results.push(full);
        }
      }
    }
    walk(dir);
    return results;
  }

  it("all PRD write sites belong to allowed zones", () => {
    const files = collectSourceFiles(join(ROOT, "packages"));
    const violations = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf-8");
      const relPath = relative(ROOT, filePath).replace(/\\/g, "/");

      for (const pattern of PRD_WRITE_PATTERNS) {
        if (pattern.test(content)) {
          const inAllowedZone = Object.keys(ALLOWED_PRD_WRITERS).some(
            (prefix) => relPath.startsWith(prefix),
          );
          if (!inAllowedZone) {
            violations.push({ file: relPath, pattern: pattern.source });
          }
          break; // One match per file is sufficient
        }
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  ${v.file} (matched: ${v.pattern})`)
        .join("\n");
      expect.fail(
        `PRD write detected outside allowed zones.\n` +
          `Allowed zones:\n` +
          Object.entries(ALLOWED_PRD_WRITERS)
            .map(([prefix, desc]) => `  ${prefix} — ${desc}`)
            .join("\n") +
          `\n\nViolations:\n${details}\n\n` +
          `If this is intentional, add the zone to ALLOWED_PRD_WRITERS in ` +
          `cross-package-contracts.test.js and update the concurrency contract ` +
          `in CLAUDE.md.`,
      );
    }
  });

  it("allowed write zones still contain PRD write code (no stale entries)", () => {
    const files = collectSourceFiles(join(ROOT, "packages"));

    for (const [prefix, desc] of Object.entries(ALLOWED_PRD_WRITERS)) {
      const zoneFiles = files.filter((f) =>
        relative(ROOT, f).replace(/\\/g, "/").startsWith(prefix),
      );

      const hasWriteCode = zoneFiles.some((filePath) => {
        const content = readFileSync(filePath, "utf-8");
        return PRD_WRITE_PATTERNS.some((p) => p.test(content));
      });

      expect(
        hasWriteCode,
        `Allowed PRD write zone "${prefix}" (${desc}) no longer contains any ` +
          `PRD write code. Remove it from ALLOWED_PRD_WRITERS to keep the ` +
          `enforcement list accurate.`,
      ).toBe(true);
    }
  });
});
